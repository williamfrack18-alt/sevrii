import { createHmac, timingSafeEqual } from "node:crypto";
import {
  getUserById,
  getUserByStripeCustomer,
  listUserWaitlists,
  replaceUserStripeCustomer,
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

const emailList = (v: string | undefined) =>
  (v || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
const ADMIN_EMAILS = emailList(process.env.SEVRII_ADMIN_EMAILS);
// SEVRII_TESTER_EMAILS (comma separated): temporary test accounts with the same
// full access. Being on the list IS the authorization: no email check, so test
// accounts without a real inbox work with their email and password. Only list
// accounts that already exist (an address nobody has registered could be
// claimed by whoever signs up with it first). Remove it + redeploy to end it.
const TESTER_EMAILS = emailList(process.env.SEVRII_TESTER_EMAILS);

type Who = Pick<UserRow, "email"> & { googleSub?: string | null; emailVerifiedAt?: string | null };

// Admins only once the email is proven theirs (Google or a reset link): anyone
// can sign up typing an admin's address before the admin does. Testers: the list.
export function isAdmin(user: Who): boolean {
  const email = user.email.toLowerCase();
  if (TESTER_EMAILS.includes(email)) return true;
  return Boolean(user.googleSub || user.emailVerifiedAt) && ADMIN_EMAILS.includes(email);
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

// A failed renewal (past_due) keeps the paid plan only for this long while
// Stripe retries the card; after that the account is treated as free.
const PAST_DUE_GRACE_MS = 14 * 24 * 60 * 60 * 1000;

type PlanFields = Pick<UserRow, "plan" | "planStatus" | "planRenewsAt">;

// The plan an account is really on right now.
export function effectivePlan(user: Who & PlanFields): PlanId {
  if (isAdmin(user)) return "team";
  const plan = (user.plan || "free") as PlanId;
  if (plan === "free" || !PLANS[plan]) return "free";
  if (!PAID_STATUSES.has(user.planStatus || "")) return "free";
  if (user.planStatus === "past_due") {
    // For past_due, planRenewsAt is when the unpaid period started (see applySubscription).
    // Unknown date (a caller that doesn't load it): keep the plan, as before.
    const since = user.planRenewsAt ? new Date(user.planRenewsAt).getTime() : NaN;
    if (Number.isFinite(since) && Date.now() > since + PAST_DUE_GRACE_MS) return "free";
  }
  return plan;
}

export function limitsFor(user: Who & PlanFields): PlanLimits {
  return PLANS[effectivePlan(user)].limits;
}

export async function clientPlan(user: UserRow): Promise<ClientPlan> {
  const status = (user.planStatus || "none") as ClientPlan["status"];
  return {
    id: effectivePlan(user),
    status: ["active", "trialing", "past_due", "canceled", "none"].includes(status) ? status : "none",
    // past_due stores when the unpaid period began, not a renewal date: don't show it as one.
    renewsAt: user.planRenewsAt && status !== "past_due" ? new Date(user.planRenewsAt).toISOString() : null,
    cancelAtPeriodEnd: Boolean(user.cancelAtPeriodEnd),
    billingReady: billingReady(),
    yearlyReady: yearlyReady(),
    waitlist: (await listUserWaitlists(user.id)).filter((p): p is PlanId => p in PLANS),
    admin: isAdmin(user),
  };
}

// ---------- Stripe REST ----------
function form(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

async function stripe<T = Record<string, unknown>>(method: "GET" | "POST" | "DELETE", path: string, params: Record<string, string> = {}, idempotencyKey?: string): Promise<T> {
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
  if (user.stripeCustomerId) {
    // The saved customer must exist in the Stripe account the keys point to
    // (it won't after switching Stripe accounts). If it's gone, make a new one.
    const stale = await customerMissing(user.stripeCustomerId);
    if (!stale) return user.stripeCustomerId;
    const fresh = await stripe<{ id: string }>("POST", "customers", { email: user.email, "metadata[userId]": user.id }, `customer-${user.id}-${user.stripeCustomerId}`);
    return await replaceUserStripeCustomer(user.id, user.stripeCustomerId, fresh.id);
  }
  // Same idempotency key for the same account: two clicks at once get the same customer.
  const c = await stripe<{ id: string }>("POST", "customers", { email: user.email, "metadata[userId]": user.id }, `customer-${user.id}`);
  // Only saved if the account has none yet; then use whatever is stored.
  return await setUserStripeCustomer(user.id, c.id);
}

// True only when Stripe says this customer doesn't exist (or was deleted).
async function customerMissing(customerId: string): Promise<boolean> {
  try {
    const c = await stripe<{ deleted?: boolean }>("GET", `customers/${encodeURIComponent(customerId)}`);
    return Boolean(c.deleted);
  } catch (err) {
    return /: 404 /.test((err as Error)?.message || "");
  }
}

const LIVE = new Set(["active", "trialing", "past_due"]);

// A subscription of this customer that is still running, if any (Stripe is the source of truth).
export async function findLiveSubscription(customerId: string): Promise<Sub | null> {
  const list = await stripe<{ data: Sub[] }>("GET", "subscriptions", { customer: customerId, status: "all", limit: "10" });
  return list.data.find((s) => LIVE.has(s.status)) ?? null;
}

export async function listLiveSubscriptions(customerId: string): Promise<Sub[]> {
  const list = await stripe<{ data: Sub[] }>("GET", "subscriptions", { customer: customerId, status: "all", limit: "20" });
  return list.data.filter((s) => LIVE.has(s.status));
}

async function expireOpenCheckouts(customerId: string): Promise<void> {
  try {
    const open = await stripe<{ data: { id: string }[] }>("GET", "checkout/sessions", { customer: customerId, status: "open", limit: "10" });
    for (const s of open.data) await stripe("POST", `checkout/sessions/${encodeURIComponent(s.id)}/expire`).catch(() => null);
  } catch (err) {
    console.error("[billing] could not expire open checkouts", (err as Error)?.message);
  }
}

// A second subscription slipped through (two checkouts paid at once): stop it
// now and give that money back, so nobody pays twice for one account.
async function cancelDuplicate(sub: Sub & { latest_invoice?: string | null }): Promise<void> {
  try {
    await stripe("DELETE", `subscriptions/${encodeURIComponent(sub.id)}`);
  } catch (err) {
    console.error("[billing] could not cancel duplicate", sub.id, (err as Error)?.message);
    return;
  }
  try {
    const invoiceId = typeof sub.latest_invoice === "string" ? sub.latest_invoice : null;
    const inv = invoiceId ? await stripe<{ payment_intent?: string | null; charge?: string | null; amount_paid?: number }>("GET", `invoices/${encodeURIComponent(invoiceId)}`) : null;
    const target: Record<string, string> | null = inv?.payment_intent ? { payment_intent: inv.payment_intent } : inv?.charge ? { charge: inv.charge } : null;
    if (target && (inv?.amount_paid ?? 0) > 0) await stripe("POST", "refunds", { ...target, reason: "duplicate" }, `refund-dup-${sub.id}`);
    else if ((inv?.amount_paid ?? 0) > 0) console.error("[billing] duplicate subscription canceled; refund it by hand in Stripe", sub.id);
  } catch (err) {
    console.error("[billing] duplicate subscription canceled; refund it by hand in Stripe", sub.id, (err as Error)?.message);
  }
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
  // Only one checkout page at a time: an older tab left open can't be paid too.
  await expireOpenCheckouts(customer);
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

// Account deletion: stop charging right away (no refund of the current period).
export async function cancelSubscriptionNow(subscriptionId: string): Promise<void> {
  try {
    await stripe("DELETE", `subscriptions/${encodeURIComponent(subscriptionId)}`);
  } catch (err) {
    // Already canceled is fine.
    if (/No such subscription|canceled/i.test((err as Error)?.message || "")) return;
    throw err;
  }
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
  current_period_start?: number;
  current_period_end?: number;
  metadata?: { userId?: string };
  items?: { data?: { current_period_start?: number; current_period_end?: number; price?: { id?: string } }[] };
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
  const sub = await stripe<Sub & { created?: number; latest_invoice?: string | null }>("GET", `subscriptions/${id}`);
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
  if (live && user.stripeSubscriptionId && user.stripeSubscriptionId !== sub.id) {
    // Two running subscriptions for one account: keep the older one.
    const current = await stripe<Sub & { created?: number }>("GET", `subscriptions/${encodeURIComponent(user.stripeSubscriptionId)}`).catch(() => null);
    if (current && LIVE.has(current.status)) {
      const keep = (current.created ?? 0) <= (sub.created ?? 0) ? current : sub;
      const drop = keep === current ? sub : current;
      await cancelDuplicate(drop as Sub & { latest_invoice?: string | null });
      if (keep === current) return;
    }
  }
  if (!live) {
    // The one on file ended, but another may still be running: use that one.
    const other = (await listLiveSubscriptions(sub.customer).catch(() => [])).find((x) => x.id !== sub.id);
    if (other) return applySubscription(other.id);
  }
  const item = sub.items?.data?.[0];
  const end = item?.current_period_end ?? sub.current_period_end;
  // Stripe moves the period forward at renewal even when the payment fails, so
  // for past_due the grace (effectivePlan) counts from when that period began.
  const start = item?.current_period_start ?? sub.current_period_start;
  const date = sub.status === "past_due" && start ? start : end;
  let plan: PlanId = "free";
  if (live) {
    const fromPrice = planFromPrice(item?.price?.id);
    if (!fromPrice) console.error("[billing] unknown price on a paying subscription; keeping a paid plan", item?.price?.id, sub.id);
    plan = fromPrice ?? (user.plan && user.plan !== "free" && PLANS[user.plan as PlanId] ? (user.plan as PlanId) : "starter");
  }
  await updateUserPlan(user.id, {
    plan,
    planStatus: live ? sub.status : "canceled",
    planRenewsAt: date ? new Date(date * 1000).toISOString() : null,
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
