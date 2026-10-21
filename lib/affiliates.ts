// Affiliates: people who promote an owner's service with their link and earn
// a commission on payments made through Sevrii (payment links and agent
// access). The commission is charged with Sevrii's fee at checkout, kept 30
// days (refunds) and then sent to the affiliate's own Stripe account.
import "server-only";
import { cookies } from "next/headers";
import { siteUrl } from "./billing";
import {
  addAffiliateSale,
  getBusinessById,
  getUserByAffCode,
  getUserById,
  listAffiliateSubscriptions,
  listDueAffiliateSales,
  setAffAccount,
  setAffPayStatus,
  setAffiliateSaleStatus,
  type BusinessRow,
  type UserRow,
} from "./db";
import { AFF_HOLD_DAYS, affCookieName, commissionOf } from "./affiliateConfig";
import { stripe, stripeV2, type CheckoutAffiliate } from "./payments";

// Who brought this customer to this business (from the visit cookie), if the
// business pays affiliates. Never the owner themselves.
export async function affiliateForCheckout(business: BusinessRow): Promise<CheckoutAffiliate | null> {
  if (!business.affiliate.enabled) return null;
  const code = (await cookies()).get(affCookieName(business.id))?.value || "";
  if (!code) return null;
  const user = await getUserByAffCode(code);
  if (!user || user.id === business.userId) return null;
  return { userId: user.id, percent: business.affiliate.percent };
}

export async function affiliateByCode(code: string): Promise<UserRow | undefined> {
  return getUserByAffCode(String(code || "").toLowerCase().slice(0, 12));
}

const payableAt = () => new Date(Date.now() + AFF_HOLD_DAYS * 24 * 3600 * 1000).toISOString();

type SessionLike = {
  id: string;
  status?: string;
  payment_status?: string;
  amount_total?: number | null;
  metadata?: Record<string, string>;
  payment_intent?: string | { id?: string } | null;
  subscription?: string | { id?: string } | null;
  invoice?: string | { id?: string } | null;
};
const idOf = (v: string | { id?: string } | null | undefined) => (typeof v === "string" ? v : v?.id ?? null);

// A paid Checkout session that came through an affiliate: record its commission
// (once). Used right after payment and by the daily check.
export async function recordAffiliateSession(business: BusinessRow, s: SessionLike): Promise<boolean> {
  const affId = s.metadata?.sevriiAff;
  const pct = Number(s.metadata?.sevriiAffPct) || 0;
  if (!affId || !pct || s.metadata?.sevriiBusinessId !== business.id) return false;
  if (s.status !== "complete" || s.payment_status !== "paid") return false;
  const amount = s.amount_total ?? 0;
  if (amount <= 0) return false;
  const sub = idOf(s.subscription);
  const inv = idOf(s.invoice);
  return addAffiliateSale({
    key: sub && inv ? `inv:${inv}` : `cs:${s.id}`,
    businessId: business.id,
    affiliateUserId: affId,
    kind: sub ? "subscription" : s.metadata?.sevriiKind === "agent" ? "agent" : "link",
    title: (s.metadata?.sevriiTitle || "").slice(0, 120),
    amountCents: amount,
    commissionCents: commissionOf(amount, pct),
    paymentIntentId: idOf(s.payment_intent),
    subscriptionId: sub,
    payableAt: payableAt(),
  });
}

export async function recordAffiliateSessionById(business: BusinessRow, sessionId: string): Promise<void> {
  if (!business.stripeAccountId || !/^cs_(live|test)_[A-Za-z0-9]{10,200}$/.test(sessionId)) return;
  try {
    const s = await stripe<SessionLike>("GET", `checkout/sessions/${encodeURIComponent(sessionId)}`, {}, { account: business.stripeAccountId });
    await recordAffiliateSession(business, s);
  } catch (err) {
    console.error("[affiliates] record failed", (err as Error)?.message);
  }
}

// Daily: catch payments whose customer never came back to the page, and
// the monthly renewals of accesses sold through an affiliate.
export async function syncBusinessSales(business: BusinessRow): Promise<number> {
  if (!business.stripeAccountId) return 0;
  let n = 0;
  try {
    const list = await stripe<{ data: SessionLike[] }>("GET", "checkout/sessions", { limit: "50", status: "complete" }, { account: business.stripeAccountId });
    for (const s of list.data) if (s.metadata?.sevriiAff && (await recordAffiliateSession(business, s))) n++;
  } catch (err) {
    console.error("[affiliates] sync sessions failed", business.id, (err as Error)?.message);
  }
  return n;
}

type Invoice = { id: string; status?: string; amount_paid?: number; payment_intent?: string | null; subscription?: string | null };

export async function syncRenewals(deadline: number): Promise<number> {
  let n = 0;
  for (const s of await listAffiliateSubscriptions(200)) {
    if (Date.now() > deadline) break;
    const business = await getBusinessById(s.businessId);
    if (!business?.stripeAccountId) continue;
    try {
      const sub = await stripe<{ metadata?: Record<string, string> }>("GET", `subscriptions/${encodeURIComponent(s.subscriptionId)}`, {}, { account: business.stripeAccountId });
      const pct = Number(sub.metadata?.sevriiAffPct) || business.affiliate.percent;
      const inv = await stripe<{ data: Invoice[] }>("GET", "invoices", { subscription: s.subscriptionId, status: "paid", limit: "12" }, { account: business.stripeAccountId });
      for (const i of inv.data) {
        const amount = i.amount_paid ?? 0;
        if (amount <= 0) continue;
        const added = await addAffiliateSale({
          key: `inv:${i.id}`,
          businessId: business.id,
          affiliateUserId: s.affiliateUserId,
          kind: "subscription",
          title: s.title,
          amountCents: amount,
          commissionCents: commissionOf(amount, pct),
          paymentIntentId: i.payment_intent ?? null,
          subscriptionId: s.subscriptionId,
          payableAt: payableAt(),
        });
        if (added) n++;
      }
    } catch (err) {
      console.error("[affiliates] renewals failed", s.subscriptionId, (err as Error)?.message);
    }
  }
  return n;
}

// ---------- Paying affiliates ----------

type PI = { latest_charge?: { refunded?: boolean; amount_refunded?: number; disputed?: boolean } | string | null };

// Still kept by the owner? (refunded or disputed payments pay no commission)
async function stillPaid(business: BusinessRow, paymentIntentId: string | null): Promise<boolean | null> {
  if (!paymentIntentId || !business.stripeAccountId) return true;
  try {
    const pi = await stripe<PI>("GET", `payment_intents/${encodeURIComponent(paymentIntentId)}`, { "expand[]": "latest_charge" }, { account: business.stripeAccountId });
    const c = pi.latest_charge && typeof pi.latest_charge === "object" ? pi.latest_charge : null;
    return !(c?.refunded || c?.disputed || (c?.amount_refunded ?? 0) > 0);
  } catch {
    return null; // couldn't check: try again tomorrow
  }
}

export async function payDueCommissions(deadline: number): Promise<{ paid: number; held: number; void: number }> {
  const out = { paid: 0, held: 0, void: 0 };
  for (const sale of await listDueAffiliateSales(50)) {
    if (Date.now() > deadline) break;
    const business = await getBusinessById(sale.businessId);
    if (!business) continue;
    const ok = await stillPaid(business, sale.paymentIntentId);
    if (ok === null) continue;
    if (!ok) {
      await setAffiliateSaleStatus(sale.id, "void");
      out.void++;
      continue;
    }
    const aff = await getUserById(sale.affiliateUserId);
    if (!aff?.affAccountId || (await refreshAffPayStatus(aff)) !== "ready") {
      if (sale.status !== "held") await setAffiliateSaleStatus(sale.id, "held");
      out.held++;
      continue;
    }
    try {
      const t = await stripe<{ id: string }>(
        "POST",
        "transfers",
        {
          amount: String(sale.commissionCents),
          currency: "usd",
          destination: aff.affAccountId,
          description: `Comisión Sevrii · ${sale.title || business.name}`.slice(0, 200),
          "metadata[sevriiSale]": sale.id,
        },
        { idempotencyKey: `aff-transfer-${sale.id}` }
      );
      await setAffiliateSaleStatus(sale.id, "paid", t.id);
      out.paid++;
    } catch (err) {
      console.error("[affiliates] transfer failed", sale.id, (err as Error)?.message);
    }
  }
  return out;
}

// ---------- The affiliate's own Stripe account (to receive commissions) ----------

type V2Recipient = {
  closed?: boolean;
  configuration?: { recipient?: { capabilities?: { stripe_balance?: { stripe_transfers?: { status?: string } } } } | null } | null;
  requirements?: { entries?: { minimum_deadline?: { status?: string } }[] } | null;
};

export async function refreshAffPayStatus(user: UserRow): Promise<string> {
  if (!user.affAccountId) return "none";
  try {
    const a = await stripeV2<V2Recipient>("GET", `core/accounts/${encodeURIComponent(user.affAccountId)}?include=configuration.recipient&include=requirements`);
    const st = a.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status;
    const due = (a.requirements?.entries || []).some((e) => ["currently_due", "past_due"].includes(e.minimum_deadline?.status || ""));
    const status = a.closed ? "none" : st === "active" ? "ready" : due ? "pending" : "review";
    if (status !== user.affPayStatus) await setAffPayStatus(user.id, status);
    return status;
  } catch (err) {
    console.error("[affiliates] account status failed", (err as Error)?.message);
    return user.affPayStatus || "none";
  }
}

export async function affiliateOnboardingUrl(user: UserRow, from: "dashboard" | "panel" = "dashboard"): Promise<string> {
  let account = user.affAccountId || "";
  if (!account) {
    const a = await stripeV2<{ id: string }>(
      "POST",
      "core/accounts",
      {
        contact_email: user.email,
        display_name: user.email.split("@")[0].slice(0, 60),
        dashboard: "express",
        identity: { country: "us" },
        configuration: { recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } } },
        defaults: { currency: "usd", responsibilities: { fees_collector: "application", losses_collector: "application" } },
        metadata: { sevriiAffiliateUserId: user.id },
      },
      `aff-account-${user.id}`
    );
    account = a.id;
    await setAffAccount(user.id, account);
  }
  const base = from === "panel" ? `${siteUrl()}/panel-afiliado?x=1` : `${siteUrl()}/dashboard?view=affiliates`;
  const link = await stripeV2<{ url: string }>("POST", "core/account_links", {
    account,
    use_case: {
      type: "account_onboarding",
      account_onboarding: { configurations: ["recipient"], refresh_url: `${base}&connect=refresh`, return_url: `${base}&connect=return` },
    },
  });
  return link.url;
}
