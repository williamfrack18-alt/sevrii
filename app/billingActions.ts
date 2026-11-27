"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/session";
import { joinPlanWaitlist } from "@/lib/db";
import { AlreadySubscribed, billingReady, createCheckoutUrl, createPortalUrl, effectivePlan, validCode, yearlyReady } from "@/lib/billing";
import { allow } from "@/lib/guard";
import { PLANS, cleanCode, readBilling, type Billing, type PlanId } from "@/lib/plans";

export type BillingResult = { url?: string; error?: "not_ready" | "failed" | "already" | "rate" };

// Starter is the only plan for sale today. Stripe Checkout handles the card.
// A discount code typed on Plans: is it valid? (Limited, so codes can't be guessed.)
export async function checkCodeAction(code: string): Promise<{ ok: boolean; error?: "rate" }> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!(await allow(`billing:code:${user.id}`, 15, 60 * 60))) return { ok: false, error: "rate" };
  return { ok: validCode(code) };
}

export async function startCheckoutAction(billing: Billing, code = ""): Promise<BillingResult> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const period = readBilling(billing);
  if (!period) return { error: "failed" };
  if (!billingReady() || !yearlyReady()) return { error: "not_ready" };
  if (effectivePlan(user) !== "free") return { error: "already" };
  if (!(await allow(`billing:checkout:${user.id}`, 10, 60 * 60))) return { error: "rate" };
  try {
    return { url: await createCheckoutUrl(user, period, { code: cleanCode(code) }) };
  } catch (err) {
    if (err instanceof AlreadySubscribed) {
      revalidatePath("/dashboard");
      return { error: "already" };
    }
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
    return { url: await createPortalUrl(user) };
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
