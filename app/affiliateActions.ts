"use server";

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { allow, clientIp } from "@/lib/guard";
import { limitsFor } from "@/lib/billing";
import { paymentsReady } from "@/lib/payments";
import {
  addAffiliateVisit,
  affiliateVisitsByBusiness,
  businessAffiliateStats,
  ensureAffCode,
  getBusinessBySlug,
  getUserById,
  listAffiliateSales,
  listBusinessAffiliateSales,
  listOpenAffiliateBusinesses,
  listServices,
  setBusinessAffiliate,
} from "@/lib/db";
import { parseAffiliate, type AffiliateSettings } from "@/lib/affiliateConfig";
import { affiliateByCode, affiliateOnboardingUrl, refreshAffPayStatus } from "@/lib/affiliates";
import { money } from "@/lib/serviceAgentConfig";

const SITE = "https://www.sevrii.com";

// A visit from an affiliate's link (counted once per visit by the page).
export async function affiliateVisitAction(input: { slug: string; code: string }): Promise<void> {
  if (!(await allow(`affvisit:${await clientIp()}`, 30, 60 * 60))) return;
  const b = await getBusinessBySlug(String(input.slug || "").slice(0, 80));
  if (!b || !b.published || !b.affiliate.enabled) return;
  const aff = await affiliateByCode(input.code);
  if (!aff || aff.id === b.userId) return;
  await addAffiliateVisit(b.id, aff.id);
}

export type AffSale = { title: string; business: string; amountCents: number; commissionCents: number; status: string; createdAt: string; payableAt: string };

export type AffiliatesState = {
  paymentsOn: boolean;
  owner: {
    businessName: string;
    published: boolean;
    payReady: boolean;
    canPublish: boolean;
    settings: AffiliateSettings;
    stats: { affiliates: number; visits: number; sales: number; salesCents: number; commissionCents: number };
    sales: AffSale[];
  } | null;
  promote: {
    code: string;
    services: { id: string; slug: string; name: string; headline: string; logo: string; percent: number; pitch: string; price: string; agent: boolean; link: string; visits: number }[];
  };
  earnings: { pendingCents: number; heldCents: number; paidCents: number; sales: AffSale[]; payout: string };
};

async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function loadAffiliatesAction(): Promise<AffiliatesState> {
  const user = await requireUser();
  const b = user.business ?? null;
  const code = await ensureAffCode(user.id);

  let owner: AffiliatesState["owner"] = null;
  if (b) {
    const sales = await listBusinessAffiliateSales(b.id, 20);
    const names: Record<string, string> = {};
    // Affiliates are shown by their code, never their email.
    for (const s of sales) if (!names[s.affiliateUserId]) names[s.affiliateUserId] = (await getUserById(s.affiliateUserId))?.affCode ?? "";
    owner = {
      businessName: b.name,
      published: Boolean(b.published),
      payReady: b.payStatus === "ready",
      canPublish: limitsFor(user).canPublish,
      settings: b.affiliate,
      stats: await businessAffiliateStats(b.id),
      sales: sales.map((s) => ({ title: s.title, business: names[s.affiliateUserId] || "", amountCents: s.amountCents, commissionCents: s.commissionCents, status: s.status, createdAt: s.createdAt, payableAt: s.payableAt })),
    };
  }

  // Services anyone can promote: published, open to affiliates, taking payments,
  // with a plan that keeps the page online. Not the person's own.
  const visits = await affiliateVisitsByBusiness(user.id);
  const open = (await listOpenAffiliateBusinesses(200)).filter((x) => x.userId !== user.id);
  const services: AffiliatesState["promote"]["services"] = [];
  for (const x of open) {
    const ownerRow = await getUserById(x.userId);
    if (!ownerRow || !limitsFor(ownerRow).canPublish) continue;
    const agent = x.plan.mode === "agent" || Boolean(x.serviceAgent.name);
    let price = "";
    if (agent && x.serviceAgent.offers.length) price = `${money(Math.min(...x.serviceAgent.offers.map((o) => o.priceCents)))}+`;
    else {
      const svc = await listServices(x.id);
      price = (svc.find((s) => s.featured) ?? svc[0])?.price ?? "";
    }
    services.push({
      id: x.id,
      slug: x.slug,
      name: x.name,
      headline: x.site.headline || x.category,
      logo: x.site.logoUrl || x.site.ownerPhotoUrl || "",
      percent: x.affiliate.percent,
      pitch: x.affiliate.pitch,
      price,
      agent,
      link: `${SITE}/site/${x.slug}?ref=${code}`,
      visits: visits[x.id] ?? 0,
    });
    if (services.length >= 60) break;
  }

  const mine = await listAffiliateSales(user.id, 50);
  const bizNames: Record<string, string> = {};
  for (const s of mine) if (!bizNames[s.businessId]) bizNames[s.businessId] = open.find((o) => o.id === s.businessId)?.name ?? "";
  const sum = (st: string) => mine.filter((s) => s.status === st).reduce((n, s) => n + s.commissionCents, 0);
  const payout = user.affAccountId ? await refreshAffPayStatus(user) : "none";

  return {
    paymentsOn: paymentsReady(),
    owner,
    promote: { code, services },
    earnings: {
      pendingCents: sum("pending"),
      heldCents: sum("held"),
      paidCents: sum("paid"),
      payout,
      sales: mine.map((s) => ({ title: s.title, business: bizNames[s.businessId] || "", amountCents: s.amountCents, commissionCents: s.commissionCents, status: s.status, createdAt: s.createdAt, payableAt: s.payableAt })),
    },
  };
}

export async function saveAffiliateSettingsAction(input: AffiliateSettings): Promise<{ ok: boolean; settings: AffiliateSettings; error?: string }> {
  const user = await requireUser();
  const b = user.business;
  if (!b) return { ok: false, settings: parseAffiliate({}), error: "nobusiness" };
  if (!(await allow(`affsave:${b.id}`, 30, 60 * 60))) return { ok: false, settings: b.affiliate, error: "rate" };
  // Same rule as the screen: published page (with a plan that publishes) and Payments connected.
  if (!b.published || !limitsFor(user).canPublish || b.payStatus !== "ready") return { ok: false, settings: b.affiliate, error: "requirements" };
  const settings = parseAffiliate(input);
  await setBusinessAffiliate(b.id, settings);
  return { ok: true, settings };
}

// The affiliate connects (or finishes) the Stripe account that receives commissions.
export async function affiliatePayoutAction(from: "dashboard" | "panel" = "dashboard"): Promise<{ url?: string; error?: string }> {
  const user = await requireUser();
  if (!paymentsReady()) return { error: "not_ready" };
  if (!(await allow(`affonboard:${user.id}`, 10, 60 * 60))) return { error: "rate" };
  try {
    return { url: await affiliateOnboardingUrl(user, from === "panel" ? "panel" : "dashboard") };
  } catch (err) {
    console.error("[affiliates] onboarding failed", (err as Error)?.message);
    return { error: "failed" };
  }
}
