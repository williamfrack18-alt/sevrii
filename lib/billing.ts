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

async function stripe<T = Record<string, unknown>>(method: "GET" | "POST", path: string, params: Record<string, string> = {}): Promise<T> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  const res = await fetch(`https://api.stripe.com/v1/${path}${method === "GET" && Object.keys(params).length ? `?${form(params)}` : ""}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: method === "POST" ? form(params) : undefined,
    cache: "no-store",
  });
  const data = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(`stripe ${path}: ${res.status} ${data?.error?.message ?? ""}`);
  return data;
}

async function ensureCustomer(user: UserRow): Promise<string> {
  if (user.stripeCustomerId) return user.stripeCustomerId;
  const c = await stripe<{ id: string }>("POST", "customers", { email: user.email, "metadata[userId]": user.id });
  await setUserStripeCustomer(user.id, c.id);
  return c.id;
}

export async function createCheckoutUrl(user: UserRow, interval: "month" | "year", origin: string): Promise<string> {
  const price = interval === "year" && process.env.STRIPE_PRICE_STARTER_YEARLY ? process.env.STRIPE_PRICE_STARTER_YEARLY : process.env.STRIPE_PRICE_STARTER_MONTHLY;
  if (!price) throw new Error("no Starter price configured");
  const customer = await ensureCustomer(user);
  const session = await stripe<{ url: string }>("POST", "checkout/sessions", {
    mode: "subscription",
    customer,
    client_reference_id: user.id,
    "line_items[0][price]": price,
    "line_items[0][quantity]": "1",
    "subscription_data[metadata][userId]": user.id,
    allow_promotion_codes: "true",
    success_url: `${origin}/dashboard?view=plans&checkout=success`,
    cancel_url: `${origin}/dashboard?view=plans&checkout=cancel`,
  });
  return session.url;
}

export async function createPortalUrl(user: UserRow, origin: string): Promise<string> {
  const customer = await ensureCustomer(user);
  const s = await stripe<{ url: string }>("POST", "billing_portal/sessions", { customer, return_url: `${origin}/dashboard?view=plans` });
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

function planFromPrice(priceId: string | undefined): PlanId {
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
  return (priceId && map[priceId]) || "free";
}

export async function applySubscription(sub: Sub): Promise<void> {
  const user = (sub.metadata?.userId && (await getUserById(sub.metadata.userId))) || (await getUserByStripeCustomer(sub.customer));
  if (!user) {
    console.warn("[billing] subscription for unknown customer", sub.customer);
    return;
  }
  const item = sub.items?.data?.[0];
  const end = item?.current_period_end ?? sub.current_period_end;
  const ended = sub.status === "canceled" || sub.status === "incomplete_expired" || sub.status === "unpaid";
  await updateUserPlan(user.id, {
    plan: ended ? "free" : planFromPrice(item?.price?.id),
    planStatus: ended ? "canceled" : sub.status,
    planRenewsAt: end ? new Date(end * 1000).toISOString() : null,
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
    stripeSubscriptionId: ended ? null : sub.id,
  });
}

export async function handleStripeEvent(event: { type: string; data: { object: Record<string, unknown> } }): Promise<void> {
  const obj = event.data.object;
  switch (event.type) {
    case "checkout.session.completed": {
      const subId = obj.subscription as string | undefined;
      if (subId) await applySubscription(await stripe<Sub>("GET", `subscriptions/${subId}`));
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await applySubscription(obj as unknown as Sub);
      break;
    default:
      break;
  }
}

export async function limitsForUserId(userId: string): Promise<PlanLimits> {
  const u = await getUserById(userId);
  return u ? limitsFor(u) : PLANS.free.limits;
}
