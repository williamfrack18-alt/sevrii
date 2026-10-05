"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/session";
import { joinPlanWaitlist } from "@/lib/db";
import { billingReady, createCheckoutUrl, createPortalUrl, effectivePlan } from "@/lib/billing";
import { allow } from "@/lib/guard";
import { PLANS, type PlanId } from "@/lib/plans";

async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") || h.get("host") || "sevrii.com";
  const proto = h.get("x-forwarded-proto") || "https";
  return `${proto}://${host}`;
}

export type BillingResult = { url?: string; error?: "not_ready" | "failed" | "already" | "rate" };

// Starter is the only plan for sale today. Stripe Checkout handles the card.
export async function startCheckoutAction(interval: "month" | "year"): Promise<BillingResult> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!billingReady()) return { error: "not_ready" };
  if (effectivePlan(user) !== "free") return { error: "already" };
  if (!(await allow(`billing:checkout:${user.id}`, 10, 60 * 60))) return { error: "rate" };
  try {
    return { url: await createCheckoutUrl(user, interval === "year" ? "year" : "month", await origin()) };
  } catch (err) {
    console.error("[billing] checkout failed", (err as Error)?.message);
    return { error: "failed" };
  }
}

// Change card, see invoices or cancel: Stripe's own billing portal.
export async function openPortalAction(): Promise<BillingResult> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!billingReady() || !user.stripeCustomerId) return { error: "not_ready" };
  try {
    return { url: await createPortalUrl(user, await origin()) };
  } catch (err) {
    console.error("[billing] portal failed", (err as Error)?.message);
    return { error: "failed" };
  }
}

// Pro and Team aren't for sale yet: people can ask to be told when they are.
export async function joinWaitlistAction(plan: string): Promise<{ ok: boolean }> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const id = plan as PlanId;
  if (!PLANS[id] || PLANS[id].available) return { ok: false };
  await joinPlanWaitlist(user.id, id);
  revalidatePath("/dashboard");
  return { ok: true };
}
