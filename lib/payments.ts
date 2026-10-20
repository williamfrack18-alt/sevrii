import { siteUrl } from "./billing";
import { replaceBusinessStripeAccount, setBusinessPayStatus, setBusinessStripeAccount, type BusinessRow, type PayStatus, type PaymentLinkRow } from "./db";

// Sevrii Payments: each business connects its own Stripe account (Stripe
// Connect) and charges its clients with "direct charges". The money lands in
// the business's Stripe account; Stripe charges its normal processing fee to
// the business, and Sevrii keeps a small application fee.
//
// Pricing rule (decided by the founder): the business pays 5% in total,
// INCLUDING Stripe's fee. So Sevrii's part is whatever is left after Stripe's
// standard US card fee (2.9% + 30¢), and never below zero.

export const TOTAL_FEE_RATE = 0.05;
const STRIPE_RATE = 0.029;
const STRIPE_FIXED_CENTS = 30;

// Below ~$14.29 Stripe's 2.9% + 30¢ alone is more than 5%, so "5% all
// included" would not hold. Keep the PaymentsView minimum and texts in sync.
export const MIN_AMOUNT_CENTS = 1500; // $15
export const MAX_AMOUNT_CENTS = 1_000_000; // $10,000

export function sevriiFeeCents(amountCents: number): number {
  const total = Math.round(amountCents * TOTAL_FEE_RATE);
  const stripe = Math.round(amountCents * STRIPE_RATE) + STRIPE_FIXED_CENTS;
  return Math.max(0, total - stripe);
}

// Everything taken from a payment (Stripe's standard fee + Sevrii's part).
export function totalFeeCents(amountCents: number): number {
  if (!amountCents) return 0;
  return Math.round(amountCents * STRIPE_RATE) + STRIPE_FIXED_CENTS + sevriiFeeCents(amountCents);
}

export function paymentsReady(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function payLinkUrl(id: string): string {
  return `${siteUrl()}/pay/${id}`;
}

// ---------- Stripe REST (with optional connected account) ----------
function form(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

async function stripe<T = Record<string, unknown>>(
  method: "GET" | "POST",
  path: string,
  params: Record<string, string> = {},
  opts: { account?: string; idempotencyKey?: string } = {}
): Promise<T> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  const headers: Record<string, string> = { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" };
  if (opts.account) headers["Stripe-Account"] = opts.account;
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
  const qs = method === "GET" && Object.keys(params).length ? `?${form(params)}` : "";
  const res = await fetch(`https://api.stripe.com/v1/${path}${qs}`, {
    method,
    headers,
    body: method === "POST" ? form(params) : undefined,
    cache: "no-store",
  });
  const data = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(`stripe ${path}: ${res.status} ${data?.error?.message ?? ""}`);
  return data;
}

// ---------- Connected accounts (Stripe Accounts v2) ----------
// Sevrii's Connect platform is set up with Stripe's Accounts v2: each business
// gets a full Stripe account (their own Stripe Dashboard). Stripe collects its
// processing fees from them and covers losses, so the platform pays no Connect
// fees. Payments still use v1 Checkout with the Stripe-Account header.
const V2_VERSION = process.env.STRIPE_V2_VERSION || "2026-09-30.preview";

async function stripeV2<T = Record<string, unknown>>(
  method: "GET" | "POST",
  path: string,
  body?: Record<string, unknown>,
  idempotencyKey?: string
): Promise<T> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  const headers: Record<string, string> = { Authorization: `Bearer ${key}`, "Stripe-Version": V2_VERSION };
  if (body) headers["Content-Type"] = "application/json";
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const res = await fetch(`https://api.stripe.com/v2/${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const data = (await res.json()) as T & { error?: { message?: string; code?: string } };
  if (!res.ok) throw new Error(`stripe v2 ${path}: ${res.status} ${data?.error?.code ?? ""} ${data?.error?.message ?? ""}`);
  return data;
}

// True when Stripe's answer means "this account doesn't exist for these keys"
// (e.g. after switching from test to live keys), not a passing error.
function isMissingAccount(err: unknown): boolean {
  const msg = (err as Error)?.message || "";
  return /: 404 /.test(msg) || /No such account|resource_missing|does not exist/i.test(msg);
}

async function accountMissing(accountId: string): Promise<boolean> {
  try {
    const a = await stripeV2<{ closed?: boolean }>("GET", `core/accounts/${encodeURIComponent(accountId)}`);
    return Boolean(a.closed);
  } catch (err) {
    return isMissingAccount(err);
  }
}

async function createAccount(business: BusinessRow, email: string, idempotencyKey: string): Promise<string> {
  const acct = await stripeV2<{ id: string }>(
    "POST",
    "core/accounts",
    {
      contact_email: email,
      display_name: business.name.slice(0, 100),
      dashboard: "full",
      identity: { country: "us" },
      configuration: { merchant: { capabilities: { card_payments: { requested: true } } } },
      defaults: { currency: "usd", responsibilities: { fees_collector: "stripe", losses_collector: "stripe" } },
      metadata: { sevriiBusinessId: business.id },
    },
    idempotencyKey
  );
  return acct.id;
}

async function ensureAccount(business: BusinessRow, email: string): Promise<string> {
  const saved = business.stripeAccountId;
  if (saved) {
    // The saved account must exist for the keys in use (it won't after
    // switching Stripe keys or platforms). If it's gone, make a new one.
    if (!(await accountMissing(saved))) return saved;
    const fresh = await createAccount(business, email, `connect-account-v2-${business.id}-${saved}`);
    return await replaceBusinessStripeAccount(business.id, saved, fresh);
  }
  const id = await createAccount(business, email, `connect-account-v2-${business.id}`);
  return await setBusinessStripeAccount(business.id, id);
}

// Where the business goes to finish (or continue) Stripe's sign-up.
export async function onboardingUrl(business: BusinessRow, email: string): Promise<string> {
  const account = await ensureAccount(business, email);
  const base = `${siteUrl()}/dashboard?view=payments`;
  const link = await stripeV2<{ url: string }>("POST", "core/account_links", {
    account,
    use_case: {
      type: "account_onboarding",
      account_onboarding: {
        refresh_url: `${base}&connect=refresh`,
        return_url: `${base}&connect=return`,
      },
    },
  });
  return link.url;
}

type V2Account = {
  closed?: boolean;
  configuration?: { merchant?: { capabilities?: { card_payments?: { status?: string } } } | null } | null;
  requirements?: {
    entries?: { awaiting_action_from?: string | { type?: string } | null; minimum_deadline?: { status?: string } }[];
  } | null;
};

export type PayState = {
  status: PayStatus;
  // Stripe restricted card payments (or doesn't support them) and asks for
  // nothing: the owner has to look in their Stripe to see why.
  blocked: boolean;
};

// Reads the account from Stripe and stores where the business is:
// ready = can take card payments; review = Stripe is checking; pending = the
// owner has to act (info missing, or blocked by Stripe); none = no account
// (the saved one doesn't exist for these keys, so setting up starts over).
export async function refreshPayState(business: BusinessRow): Promise<PayState> {
  if (!business.stripeAccountId) return { status: "none", blocked: false };
  const id = encodeURIComponent(business.stripeAccountId);
  let a: V2Account | null = null;
  try {
    a = await stripeV2<V2Account>("GET", `core/accounts/${id}?include=configuration.merchant&include=requirements`);
  } catch (err) {
    if (!isMissingAccount(err)) throw err;
  }
  let state: PayState;
  if (!a || a.closed) {
    state = { status: "none", blocked: false };
  } else {
    const card = a.configuration?.merchant?.capabilities?.card_payments?.status;
    const entries = a.requirements?.entries || [];
    const due = entries.some((e) => ["currently_due", "past_due"].includes(e.minimum_deadline?.status || ""));
    const stripeChecking = entries.some((e) => {
      const from = e.awaiting_action_from;
      return (typeof from === "string" ? from : from?.type) === "stripe";
    });
    if (card === "active") state = { status: "ready", blocked: false };
    else if (due) state = { status: "pending", blocked: false };
    else if (card === "unsupported" || (card === "restricted" && !stripeChecking)) state = { status: "pending", blocked: true };
    else state = { status: "review", blocked: false };
  }
  if (state.status !== business.payStatus) await setBusinessPayStatus(business.id, state.status);
  return state;
}

export async function refreshPayStatus(business: BusinessRow): Promise<PayStatus> {
  return (await refreshPayState(business)).status;
}

// ---------- Charging a client ----------
export async function checkoutForLink(business: BusinessRow, link: PaymentLinkRow): Promise<string> {
  if (!business.stripeAccountId) throw new Error("business has no Stripe account");
  const fee = sevriiFeeCents(link.amountCents);
  const back = `${siteUrl()}/pay/${link.id}`;
  const params: Record<string, string> = {
    mode: "payment",
    // Cards only (Apple Pay / Google Pay go through card): other methods have
    // other Stripe fees, which breaks "5% all included", and bank debits settle days later.
    "payment_method_types[0]": "card",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(link.amountCents),
    "line_items[0][price_data][product_data][name]": link.title.slice(0, 120),
    "payment_intent_data[description]": `${link.title} · ${business.name}`.slice(0, 200),
    "payment_intent_data[metadata][sevriiLinkId]": link.id,
    "metadata[sevriiLinkId]": link.id,
    "metadata[sevriiBusinessId]": business.id,
    "metadata[sevriiTitle]": link.title.slice(0, 120),
    success_url: `${back}?paid=1&s={CHECKOUT_SESSION_ID}`,
    cancel_url: back,
  };
  if (link.description) params["line_items[0][price_data][product_data][description]"] = link.description.slice(0, 300);
  if (fee > 0) params["payment_intent_data[application_fee_amount]"] = String(fee);
  const s = await stripe<{ url: string }>("POST", "checkout/sessions", params, { account: business.stripeAccountId });
  return s.url;
}

export type ReceivedPayment = {
  id: string;
  title: string;
  amountCents: number;
  feeCents: number;
  email: string | null;
  name: string | null;
  createdAt: string;
};

type Charge = { refunded?: boolean; amount_refunded?: number; disputed?: boolean };

type Session = {
  id: string;
  created: number;
  amount_total: number | null;
  payment_status: string;
  status?: string;
  metadata?: Record<string, string>;
  customer_details?: { email?: string | null; name?: string | null } | null;
  // Only an object when expanded (see listReceivedPayments).
  payment_intent?: string | { latest_charge?: string | Charge | null } | null;
};

// The latest paid Sevrii payments, read straight from the business's Stripe account.
// Fully refunded or disputed payments are left out, and partial refunds are
// taken off the amount, so the totals show money really kept.
export async function listReceivedPayments(business: BusinessRow): Promise<ReceivedPayment[]> {
  if (!business.stripeAccountId) return [];
  const account = business.stripeAccountId;
  const params = { limit: "50", status: "complete" };
  let list: { data: Session[] };
  try {
    list = await stripe<{ data: Session[] }>("GET", "checkout/sessions", { ...params, "expand[]": "data.payment_intent.latest_charge" }, { account });
  } catch (err) {
    console.error("[payments] expanded list failed; listing without refunds", (err as Error)?.message);
    list = await stripe<{ data: Session[] }>("GET", "checkout/sessions", params, { account });
  }
  const out: ReceivedPayment[] = [];
  for (const s of list.data) {
    if (s.payment_status !== "paid" || s.metadata?.sevriiBusinessId !== business.id) continue;
    const pi = s.payment_intent;
    const charge = pi && typeof pi === "object" && pi.latest_charge && typeof pi.latest_charge === "object" ? pi.latest_charge : null;
    if (charge?.refunded || charge?.disputed) continue;
    const amount = s.amount_total ?? 0;
    const refunded = Math.min(amount, Math.max(0, charge?.amount_refunded ?? 0));
    out.push({
      id: s.id,
      title: s.metadata?.sevriiTitle || "",
      amountCents: amount - refunded,
      // Approximate total taken (Stripe's standard fee + Sevrii's part), on
      // the original amount: those fees aren't given back on a refund.
      feeCents: Math.min(amount - refunded, totalFeeCents(amount)),
      email: s.customer_details?.email ?? null,
      name: s.customer_details?.name ?? null,
      createdAt: new Date(s.created * 1000).toISOString(),
    });
  }
  return out;
}

// One paid Sevrii session, read from the business's own Stripe account.
// Returns null unless it is really paid and really belongs to this business.
// With throwOnError, a failed Stripe call throws instead of returning null
// (so a caller can tell "not paid" from "couldn't check" and retry).
export async function getPaidSession(business: BusinessRow, sessionId: string, opts: { throwOnError?: boolean } = {}): Promise<ReceivedPayment | null> {
  if (!business.stripeAccountId || !/^cs_(live|test)_[A-Za-z0-9]{10,200}$/.test(sessionId)) return null;
  try {
    const s = await stripe<Session>("GET", `checkout/sessions/${encodeURIComponent(sessionId)}`, {}, { account: business.stripeAccountId });
    if (s.payment_status !== "paid" || s.metadata?.sevriiBusinessId !== business.id) return null;
    const amount = s.amount_total ?? 0;
    return {
      id: s.id,
      title: s.metadata?.sevriiTitle || "",
      amountCents: amount,
      feeCents: totalFeeCents(amount),
      email: s.customer_details?.email ?? null,
      name: s.customer_details?.name ?? null,
      createdAt: new Date(s.created * 1000).toISOString(),
    };
  } catch (err) {
    if (opts.throwOnError) throw err;
    return null;
  }
}

// What the "back from Stripe" page may say: only what Stripe itself confirms
// for this exact link (a "?paid=1" typed into the address bar proves nothing).
export async function paySessionState(business: BusinessRow, sessionId: string, linkId: string): Promise<"paid" | "processing" | null> {
  if (!business.stripeAccountId || !/^cs_(live|test)_[A-Za-z0-9]{10,200}$/.test(sessionId)) return null;
  try {
    const s = await stripe<Session>("GET", `checkout/sessions/${encodeURIComponent(sessionId)}`, {}, { account: business.stripeAccountId });
    if (s.metadata?.sevriiBusinessId !== business.id || s.metadata?.sevriiLinkId !== linkId) return null;
    if (s.payment_status === "paid" || s.payment_status === "no_payment_required") return "paid";
    if (s.status === "complete") return "processing"; // bank payments settle later
    return null;
  } catch {
    return null;
  }
}

// ---------- Service agents: customers pay for access ----------
// The same direct charges as payment links (5% all included): a one-time
// access, or a monthly subscription on the business's own Stripe account.
export async function checkoutForAgentOffer(
  business: BusinessRow,
  offer: { id: string; title: string; detail: string; priceCents: number; billing: "once" | "monthly" },
  agentName: string,
  conversationId: string
): Promise<string> {
  if (!business.stripeAccountId) throw new Error("business has no Stripe account");
  const back = `${siteUrl()}/site/${encodeURIComponent(business.slug)}`;
  const name = `${offer.title} · ${agentName || business.name}`.slice(0, 120);
  const fee = sevriiFeeCents(offer.priceCents);
  const params: Record<string, string> = {
    mode: offer.billing === "monthly" ? "subscription" : "payment",
    "payment_method_types[0]": "card",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(offer.priceCents),
    "line_items[0][price_data][product_data][name]": name,
    "metadata[sevriiBusinessId]": business.id,
    "metadata[sevriiKind]": "agent",
    "metadata[sevriiOffer]": offer.id,
    "metadata[sevriiConv]": conversationId,
    "metadata[sevriiTitle]": name,
    success_url: `${back}?agent_paid={CHECKOUT_SESSION_ID}`,
    cancel_url: back,
  };
  if (offer.detail) params["line_items[0][price_data][product_data][description]"] = offer.detail.slice(0, 300);
  if (offer.billing === "monthly") {
    params["line_items[0][price_data][recurring][interval]"] = "month";
    params["subscription_data[metadata][sevriiBusinessId]"] = business.id;
    params["subscription_data[metadata][sevriiConv]"] = conversationId;
    // Subscriptions take a percent: the same share as a one-time charge.
    const pct = Math.floor((fee / offer.priceCents) * 10000) / 100;
    if (pct > 0) params["subscription_data[application_fee_percent]"] = String(pct);
  } else {
    params["payment_intent_data[description]"] = name.slice(0, 200);
    if (fee > 0) params["payment_intent_data[application_fee_amount]"] = String(fee);
  }
  const s = await stripe<{ url: string }>("POST", "checkout/sessions", params, { account: business.stripeAccountId });
  return s.url;
}

type SubLike = {
  id?: string;
  status?: string;
  current_period_end?: number;
  items?: { data?: { current_period_end?: number }[] };
};
const periodEnd = (sub: SubLike | null | undefined): number => sub?.current_period_end ?? sub?.items?.data?.[0]?.current_period_end ?? 0;

export type AgentPaid = {
  offerId: string;
  conversationId: string;
  amountCents: number;
  email: string | null;
  subscriptionId: string | null;
  periodEnd: number | null; // monthly: unix seconds
};

// A paid agent checkout, read straight from the business's Stripe account
// (never trusted from the address bar). Null unless paid and theirs.
export async function getPaidAgentSession(business: BusinessRow, sessionId: string): Promise<AgentPaid | null> {
  if (!business.stripeAccountId || !/^cs_(live|test)_[A-Za-z0-9]{10,200}$/.test(sessionId)) return null;
  try {
    const s = await stripe<Session & { subscription?: string | SubLike | null }>(
      "GET",
      `checkout/sessions/${encodeURIComponent(sessionId)}`,
      { "expand[]": "subscription" },
      { account: business.stripeAccountId }
    );
    if (s.metadata?.sevriiBusinessId !== business.id || s.metadata?.sevriiKind !== "agent") return null;
    if (s.payment_status !== "paid" || s.status !== "complete") return null;
    const sub = s.subscription && typeof s.subscription === "object" ? s.subscription : null;
    return {
      offerId: s.metadata?.sevriiOffer || "",
      conversationId: s.metadata?.sevriiConv || "",
      amountCents: s.amount_total ?? 0,
      email: s.customer_details?.email ?? null,
      subscriptionId: sub?.id ?? (typeof s.subscription === "string" ? s.subscription : null),
      periodEnd: sub ? periodEnd(sub) || null : null,
    };
  } catch (err) {
    console.error("[payments] agent session check failed", (err as Error)?.message);
    return null;
  }
}

// A monthly access: still paid? Returns the end of the current period, or 0
// when the subscription ended (null when Stripe couldn't be reached).
export async function agentSubscriptionEnd(business: BusinessRow, subscriptionId: string): Promise<number | null> {
  if (!business.stripeAccountId || !/^sub_[A-Za-z0-9]{6,200}$/.test(subscriptionId)) return 0;
  try {
    const sub = await stripe<SubLike>("GET", `subscriptions/${encodeURIComponent(subscriptionId)}`, {}, { account: business.stripeAccountId });
    return sub.status === "active" || sub.status === "trialing" ? periodEnd(sub) : 0;
  } catch (err) {
    console.error("[payments] subscription check failed", (err as Error)?.message);
    return null;
  }
}
