import { createHmac, timingSafeEqual } from "node:crypto";
import {
  getUserById,
  getUserByStripeCustomer,
  listUserWaitlists,
  setUserStripeCustomer,
  updateUserPlan,
  type UserRow,
} from "./db";
import { PLANS, type ClientPlan, type PlanId, type PlanLimits } from "./plans";

// Billing with Stripe, using its REST API directly (no extra package).
// Keys live only in Vercel env vars, set by the founder:
//   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
//   STRIPE_PRICE_STARTER_MONTHLY, STRIPE_PRICE_STARTER_YEARLY (optional)
// SEVRII_ADMIN_EMAILS (comma separated) get every feature, for testing.

const ADMIN_EMAILS = (process.env.SEVRII_ADMIN_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export function isAdmin(email: string): boolean {
  return ADMIN_EMAILS.includes(email.toLowerCase());
}

export function billingReady(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET && process.env.STRIPE_PRICE_STARTER_MONTHLY);
}

// The yearly option is only offered when its Stripe price exists.
export function yearlyReady(): boolean {
  return billingReady() && Boolean(process.env.STRIPE_PRICE_STARTER_YEARLY);
}

// Where Stripe sends people back. Never built from request headers.
export function siteUrl(): string {
  return (process.env.SEVRII_SITE_URL || "https://sevrii.com").replace(/\/$/, "");
}

const PAID_STATUSES = new Set(["active", "trialing", "past_due"]);

// The plan an account is really on right now.
export function effectivePlan(user: Pick<UserRow, "email" | "plan" | "planStatus">): PlanId {
  if (isAdmin(user.email)) return "team";
  const plan = (user.plan || "free") as PlanId;
  if (plan === "free" || !PLANS[plan]) return "free";
  return PAID_STATUSES.has(user.planStatus || "") ? plan : "free";
}

export function limitsFor(user: Pick<UserRow, "email" | "plan" | "planStatus">): PlanLimits {
  return PLANS[effectivePlan(user)].limits;
}

export async function clientPlan(user: UserRow): Promise<ClientPlan> {
  const status = (user.planStatus || "none") as ClientPlan["status"];
  return {
    id: effectivePlan(user),
    status: ["active", "trialing", "past_due", "canceled", "none"].includes(status) ? status : "none",
    renewsAt: user.planRenewsAt ? new Date(user.planRenewsAt).toISOString() : null,
    cancelAtPeriodEnd: Boolean(user.cancelAtPeriodEnd),
    billingReady: billingReady(),
    yearlyReady: yearlyReady(),
    waitlist: (await listUserWaitlists(user.id)).filter((p): p is PlanId => p in PLANS),
    admin: isAdmin(user.email),
  };
}

// ---------- Stripe REST ----------
function form(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

async function stripe<T = Record<string, unknown>>(method: "GET" | "POST", path: string, params: Record<string, string> = {}, idempotencyKey?: string): Promise<T> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  const headers: Record<string, string> = { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const res = await fetch(`https://api.stripe.com/v1/${path}${method === "GET" && Object.keys(params).length ? `?${form(params)}` : ""}`, {
    method,
    headers,
    body: method === "POST" ? form(params) : undefined,
    cache: "no-store",
  });
  const data = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(`stripe ${path}: ${res.status} ${data?.error?.message ?? ""}`);
  return data;
}

async function ensureCustomer(user: UserRow): Promise<string> {
  if (user.stripeCustomerId) return user.stripeCustomerId;
  // Same idempotency key for the same account: two clicks at once get the same customer.
  const c = await stripe<{ id: string }>("POST", "customers", { email: user.email, "metadata[userId]": user.id }, `customer-${user.id}`);
  // Only saved if the account has none yet; then use whatever is stored.
  return await setUserStripeCustomer(user.id, c.id);
}

const LIVE = new Set(["active", "trialing", "past_due"]);

// A subscription of this customer that is still running, if any (Stripe is the source of truth).
export async function findLiveSubscription(customerId: string): Promise<Sub | null> {
  const list = await stripe<{ data: Sub[] }>("GET", "subscriptions", { customer: customerId, status: "all", limit: "10" });
  return list.data.find((s) => LIVE.has(s.status)) ?? null;
}

export class AlreadySubscribed extends Error {}

export async function createCheckoutUrl(user: UserRow, interval: "month" | "year"): Promise<string> {
  // Never charge a different interval than the one the person chose.
  const price = interval === "year" ? process.env.STRIPE_PRICE_STARTER_YEARLY : process.env.STRIPE_PRICE_STARTER_MONTHLY;
  if (!price) throw new Error(`no Starter ${interval} price configured`);
  const customer = await ensureCustomer(user);
  // Already paying (maybe the webhook hasn't arrived yet)? Sync instead of selling twice.
  const live = await findLiveSubscription(customer);
  if (live) {
    await applySubscription(live);
    throw new AlreadySubscribed();
  }
  const origin = siteUrl();
  const tax: Record<string, string> =
    process.env.STRIPE_AUTOMATIC_TAX === "1" ? { "automatic_tax[enabled]": "true", "customer_update[address]": "auto" } : {};
  const session = await stripe<{ url: string }>("POST", "checkout/sessions", {
    ...tax,
    mode: "subscription",
    customer,
    client_reference_id: user.id,
    "line_items[0][price]": price,
    "line_items[0][quantity]": "1",
    "subscription_data[metadata][userId]": user.id,
    allow_promotion_codes: "true",
    success_url: `${origin}/dashboard?view=plans&checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/dashboard?view=plans&checkout=cancel`,
  });
  return session.url;
}

export async function createPortalUrl(user: UserRow): Promise<string> {
  const customer = await ensureCustomer(user);
  const s = await stripe<{ url: string }>("POST", "billing_portal/sessions", { customer, return_url: `${siteUrl()}/dashboard?view=plans` });
  return s.url;
}

// ---------- Webhook ----------
export function verifyStripeSignature(payload: string, header: string | null, secret: string, toleranceSec = 300): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i), p.slice(i + 1)];
    })
  );
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  const sigs = header
    .split(",")
    .filter((p) => p.startsWith("v1="))
    .map((p) => p.slice(3));
  return sigs.some((s) => s.length === expected.length && timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}

type Sub = {
  id: string;
  customer: string;
  status: string;
  cancel_at_period_end: boolean;
  current_period_end?: number;
  metadata?: { userId?: string };
  items?: { data?: { current_period_end?: number; price?: { id?: string } }[] };
};

function planFromPrice(priceId: string | undefined): PlanId | null {
  const map: Record<string, PlanId> = {};
  for (const [env, plan] of [
    ["STRIPE_PRICE_STARTER_MONTHLY", "starter"],
    ["STRIPE_PRICE_STARTER_YEARLY", "starter"],
    ["STRIPE_PRICE_PRO_MONTHLY", "pro"],
    ["STRIPE_PRICE_PRO_YEARLY", "pro"],
    ["STRIPE_PRICE_TEAM_MONTHLY", "team"],
  ] as const) {
    const v = process.env[env];
    if (v) map[v] = plan;
  }
  return (priceId && map[priceId]) || null;
}

// Apply a subscription's CURRENT state, always read from Stripe, so old or
// out-of-order webhook deliveries can't give or take away a plan by mistake.
export async function applySubscription(subOrId: Sub | string): Promise<void> {
  const id = typeof subOrId === "string" ? subOrId : subOrId.id;
  const sub = await stripe<Sub>("GET", `subscriptions/${id}`);
  const user = (sub.metadata?.userId && (await getUserById(sub.metadata.userId))) || (await getUserByStripeCustomer(sub.customer));
  if (!user) {
    console.warn("[billing] subscription for unknown customer", sub.customer);
    return;
  }
  const live = LIVE.has(sub.status);
  // An older subscription ending must not cancel a newer one that is running.
  if (!live && user.stripeSubscriptionId && user.stripeSubscriptionId !== sub.id) {
    console.info("[billing] ignoring end of an old subscription", sub.id);
    return;
  }
  const item = sub.items?.data?.[0];
  const end = item?.current_period_end ?? sub.current_period_end;
  let plan: PlanId = "free";
  if (live) {
    const fromPrice = planFromPrice(item?.price?.id);
    if (!fromPrice) console.error("[billing] unknown price on a paying subscription; keeping a paid plan", item?.price?.id, sub.id);
    plan = fromPrice ?? (user.plan && user.plan !== "free" && PLANS[user.plan as PlanId] ? (user.plan as PlanId) : "starter");
  }
  await updateUserPlan(user.id, {
    plan,
    planStatus: live ? sub.status : "canceled",
    planRenewsAt: end ? new Date(end * 1000).toISOString() : null,
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
    stripeSubscriptionId: live ? sub.id : null,
  });
}

// Coming back from Checkout: activate right away instead of waiting for the webhook.
export async function syncCheckoutSession(user: UserRow, sessionId: string): Promise<void> {
  if (!billingReady() || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return;
  try {
    const s = await stripe<{ customer?: string; client_reference_id?: string; subscription?: string }>("GET", `checkout/sessions/${sessionId}`);
    if (s.client_reference_id !== user.id && s.customer !== user.stripeCustomerId) return;
    if (s.subscription) await applySubscription(s.subscription);
  } catch (err) {
    console.error("[billing] checkout sync failed", (err as Error)?.message);
  }
}

export async function handleStripeEvent(event: { type: string; data: { object: Record<string, unknown> } }): Promise<void> {
  const obj = event.data.object;
  if (event.type === "checkout.session.completed") {
    const subId = obj.subscription as string | undefined;
    if (subId) await applySubscription(subId);
  } else if (event.type.startsWith("customer.subscription.")) {
    await applySubscription(String(obj.id));
  }
}

export async function limitsForUserId(userId: string): Promise<PlanLimits> {
  const u = await getUserById(userId);
  return u ? limitsFor(u) : PLANS.free.limits;
}
