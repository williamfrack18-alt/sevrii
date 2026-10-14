import { siteUrl } from "./billing";
import { setBusinessPayStatus, setBusinessStripeAccount, type BusinessRow, type PayStatus, type PaymentLinkRow } from "./db";

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

export const MIN_AMOUNT_CENTS = 500; // $5
export const MAX_AMOUNT_CENTS = 1_000_000; // $10,000

export function sevriiFeeCents(amountCents: number): number {
  const total = Math.round(amountCents * TOTAL_FEE_RATE);
  const stripe = Math.round(amountCents * STRIPE_RATE) + STRIPE_FIXED_CENTS;
  return Math.max(0, total - stripe);
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

async function ensureAccount(business: BusinessRow, email: string): Promise<string> {
  if (business.stripeAccountId) return business.stripeAccountId;
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
    `connect-account-v2-${business.id}`
  );
  return await setBusinessStripeAccount(business.id, acct.id);
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
        configurations: ["merchant"],
        refresh_url: `${base}&connect=refresh`,
        return_url: `${base}&connect=return`,
      },
    },
  });
  return link.url;
}

type V2Account = {
  configuration?: { merchant?: { capabilities?: { card_payments?: { status?: string } } } | null } | null;
  requirements?: { entries?: { minimum_deadline?: { status?: string } }[] } | null;
};

// Reads the account from Stripe and stores where the business is:
// ready = can take card payments; review = Stripe is checking; pending = info missing.
export async function refreshPayStatus(business: BusinessRow): Promise<PayStatus> {
  if (!business.stripeAccountId) return "none";
  const id = encodeURIComponent(business.stripeAccountId);
  const a = await stripeV2<V2Account>("GET", `core/accounts/${id}?include=configuration.merchant&include=requirements`);
  const card = a.configuration?.merchant?.capabilities?.card_payments?.status;
  const due = (a.requirements?.entries || []).some((e) => ["currently_due", "past_due"].includes(e.minimum_deadline?.status || ""));
  const status: PayStatus = card === "active" ? "ready" : due ? "pending" : "review";
  if (status !== business.payStatus) await setBusinessPayStatus(business.id, status);
  return status;
}

// ---------- Charging a client ----------
export async function checkoutForLink(business: BusinessRow, link: PaymentLinkRow): Promise<string> {
  if (!business.stripeAccountId) throw new Error("business has no Stripe account");
  const fee = sevriiFeeCents(link.amountCents);
  const back = `${siteUrl()}/pay/${link.id}`;
  const params: Record<string, string> = {
    mode: "payment",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(link.amountCents),
    "line_items[0][price_data][product_data][name]": link.title.slice(0, 120),
    "payment_intent_data[description]": `${link.title} · ${business.name}`.slice(0, 200),
    "payment_intent_data[metadata][sevriiLinkId]": link.id,
    "metadata[sevriiLinkId]": link.id,
    "metadata[sevriiBusinessId]": business.id,
    "metadata[sevriiTitle]": link.title.slice(0, 120),
    success_url: `${back}?paid=1`,
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

type Session = {
  id: string;
  created: number;
  amount_total: number | null;
  payment_status: string;
  metadata?: Record<string, string>;
  customer_details?: { email?: string | null; name?: string | null } | null;
};

// The latest paid Sevrii payments, read straight from the business's Stripe account.
export async function listReceivedPayments(business: BusinessRow): Promise<ReceivedPayment[]> {
  if (!business.stripeAccountId) return [];
  const list = await stripe<{ data: Session[] }>("GET", "checkout/sessions", { limit: "50", status: "complete" }, { account: business.stripeAccountId });
  return list.data
    .filter((s) => s.payment_status === "paid" && s.metadata?.sevriiBusinessId === business.id)
    .map((s) => {
      const amount = s.amount_total ?? 0;
      return {
        id: s.id,
        title: s.metadata?.sevriiTitle || "",
        amountCents: amount,
        // Approximate total taken (Stripe's standard fee + Sevrii's part).
        feeCents: amount ? Math.round(amount * STRIPE_RATE) + STRIPE_FIXED_CENTS + sevriiFeeCents(amount) : 0,
        email: s.customer_details?.email ?? null,
        name: s.customer_details?.name ?? null,
        createdAt: new Date(s.created * 1000).toISOString(),
      };
    });
}
