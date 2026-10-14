"use server";

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { countPaymentLinks, createPaymentLink, getBusinessById, listPaymentLinks, setPaymentLinkActive, type PayStatus } from "@/lib/db";
import { allow } from "@/lib/guard";
import {
  listReceivedPayments,
  MAX_AMOUNT_CENTS,
  MIN_AMOUNT_CENTS,
  onboardingUrl,
  paymentsReady,
  payLinkUrl,
  refreshPayStatus,
  type ReceivedPayment,
} from "@/lib/payments";

export type ClientPayLink = { id: string; title: string; amountCents: number; description: string | null; active: boolean; url: string };
export type PaymentsState = {
  ready: boolean; // Stripe keys are set on Sevrii
  status: PayStatus;
  links: ClientPayLink[];
  payments: ReceivedPayment[];
  error?: "stripe";
};

async function requireBusiness() {
  const user = await getCurrentUser();
  if (!user || !user.business) redirect("/login");
  return { user, business: user.business };
}

function toClient(l: { id: string; title: string; amountCents: number; description: string | null; active: boolean }): ClientPayLink {
  return { id: l.id, title: l.title, amountCents: l.amountCents, description: l.description, active: l.active, url: payLinkUrl(l.id) };
}

// Everything the Payments screen needs. Reads the account status and the
// latest payments from Stripe each time the screen opens.
export async function loadPaymentsAction(): Promise<PaymentsState> {
  const { business } = await requireBusiness();
  const links = (await listPaymentLinks(business.id)).map(toClient);
  const base: PaymentsState = { ready: paymentsReady(), status: (business.payStatus as PayStatus) || "none", links, payments: [] };
  if (!base.ready || !business.stripeAccountId) return base;
  try {
    const status = await refreshPayStatus(business);
    const fresh = (await getBusinessById(business.id)) ?? business;
    const payments = status === "ready" ? await listReceivedPayments(fresh) : [];
    return { ...base, status, payments };
  } catch (err) {
    console.error("[payments] load failed", (err as Error)?.message);
    return { ...base, error: "stripe" };
  }
}

// Sends the owner to Stripe to create or finish their account.
export async function startOnboardingAction(): Promise<{ url?: string; error?: "not_ready" | "rate" | "connect" | "failed" }> {
  const { user, business } = await requireBusiness();
  if (!paymentsReady()) return { error: "not_ready" };
  if (!(await allow(`payments:onboard:${business.id}`, 12, 60 * 60))) return { error: "rate" };
  try {
    return { url: await onboardingUrl(business, user.email) };
  } catch (err) {
    const msg = (err as Error)?.message || "";
    console.error("[payments] onboarding failed", msg);
    // The platform hasn't finished turning on Stripe Connect yet.
    if (/connect/i.test(msg) && /sign(ed)? up|platform|review|activate/i.test(msg)) return { error: "connect" };
    return { error: "failed" };
  }
}

function clip(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

// "120", "120.50", "$1,200" → cents. Anything else → null.
function toCents(raw: unknown): number | null {
  const s = String(raw ?? "").replace(/[$,\s]/g, "");
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

export async function createPayLinkAction(input: {
  title: string;
  amount: string;
  description?: string;
}): Promise<{ ok: true; links: ClientPayLink[] } | { ok: false; error: "title" | "amount" | "limit" | "rate" | "not_ready" }> {
  const { business } = await requireBusiness();
  if (business.payStatus !== "ready") return { ok: false, error: "not_ready" };
  const title = clip(input.title, 80);
  if (title.length < 2) return { ok: false, error: "title" };
  const cents = toCents(input.amount);
  if (cents === null || cents < MIN_AMOUNT_CENTS || cents > MAX_AMOUNT_CENTS) return { ok: false, error: "amount" };
  if (!(await allow(`payments:link:${business.id}`, 40, 60 * 60))) return { ok: false, error: "rate" };
  if ((await countPaymentLinks(business.id)) >= 100) return { ok: false, error: "limit" };
  const description = clip(input.description, 240) || null;
  await createPaymentLink(business.id, title, cents, description);
  return { ok: true, links: (await listPaymentLinks(business.id)).map(toClient) };
}

export async function setPayLinkActiveAction(id: string, active: boolean): Promise<ClientPayLink[]> {
  const { business } = await requireBusiness();
  await setPaymentLinkActive(String(id), business.id, Boolean(active));
  return (await listPaymentLinks(business.id)).map(toClient);
}
