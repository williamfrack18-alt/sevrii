"use server";

import { getCurrentUser } from "@/lib/session";
import { allow, clientIp } from "@/lib/guard";
import { cleanEmail, currentCustomer, hashToken, signInCustomer, signOutCustomer } from "@/lib/customers";
import {
  customerBoughtFrom,
  getBusinessById,
  getBusinessReview,
  listBusinessReviews,
  purchaseByReviewToken,
  replyBusinessReview,
  reportBusinessReview,
  saveBusinessReview,
} from "@/lib/db";
import { notifyAdmins } from "@/lib/notify";

const clip = (v: unknown, max: number) => String(v ?? "").replace(/\u0000/g, "").replace(/\s+/g, " ").trim().slice(0, max);

// The customer's quick account, made right before paying: a name and an email.
export async function quickAccountAction(input: { name: string; email: string }): Promise<{ ok: boolean; name?: string; error?: "name" | "email" | "rate" }> {
  const name = clip(input.name, 40);
  const email = cleanEmail(input.email);
  if (name.length < 2) return { ok: false, error: "name" };
  if (!email) return { ok: false, error: "email" };
  if (!(await allow(`custacct:${await clientIp()}`, 10, 60 * 60))) return { ok: false, error: "rate" };
  const c = await signInCustomer(email, name);
  return { ok: true, name: c.name };
}

export async function customerSignOutAction(): Promise<void> {
  await signOutCustomer();
}

export type ReviewState = { canReview: boolean; rating: number; text: string; name: string };

// Who may review: the signed-in customer who bought from this business, or
// whoever holds the review link emailed after a purchase.
async function reviewer(businessId: string, token?: string): Promise<{ customerId: string; name: string } | null> {
  if (token && /^[a-f0-9]{64}$/.test(token)) {
    const p = await purchaseByReviewToken(hashToken(token));
    if (p && p.businessId === businessId && p.customerId) return { customerId: p.customerId, name: "" };
  }
  const c = await currentCustomer();
  if (c && (await customerBoughtFrom(c.id, businessId))) return { customerId: c.id, name: c.name };
  return null;
}

export async function reviewStateAction(input: { businessId: string; token?: string }): Promise<ReviewState> {
  const none = { canReview: false, rating: 0, text: "", name: "" };
  const b = await getBusinessById(String(input.businessId || "").slice(0, 64));
  if (!b) return none;
  const who = await reviewer(b.id, input.token);
  if (!who) return none;
  const r = await getBusinessReview(b.id, who.customerId);
  return { canReview: true, rating: r?.rating ?? 0, text: r?.text ?? "", name: r?.name || who.name };
}

export async function saveReviewAction(input: { businessId: string; token?: string; rating: number; text: string; name: string }): Promise<{ ok: boolean }> {
  const b = await getBusinessById(String(input.businessId || "").slice(0, 64));
  const rating = Math.round(Number(input.rating));
  if (!b || !(rating >= 1 && rating <= 5)) return { ok: false };
  if (!(await allow(`review:${await clientIp()}`, 10, 60 * 60))) return { ok: false };
  const who = await reviewer(b.id, input.token);
  if (!who) return { ok: false };
  // The owner can't review their own business.
  const viewer = await getCurrentUser().catch(() => null);
  if (viewer?.id === b.userId) return { ok: false };
  await saveBusinessReview({
    businessId: b.id,
    customerId: who.customerId,
    rating,
    text: clip(input.text, 800),
    name: clip(input.name, 40) || who.name || (b.site.lang === "en" ? "Customer" : "Cliente"),
  });
  return { ok: true };
}

// ---------- the owner ----------
export type OwnerReview = { id: string; rating: number; text: string; name: string; reply: string; reported: boolean; hidden: boolean; createdAt: string };

export async function ownerReviewsAction(): Promise<{ list: OwnerReview[]; avg: number | null; count: number } | null> {
  const user = await getCurrentUser();
  const b = user?.business;
  if (!b) return null;
  const r = await listBusinessReviews(b.id, 100, true);
  return { avg: r.avg, count: r.count, list: r.list.map((x) => ({ id: x.id, rating: x.rating, text: x.text, name: x.name, reply: x.reply, reported: x.reported, hidden: x.hidden, createdAt: x.createdAt })) };
}

export async function replyReviewAction(id: string, reply: string): Promise<boolean> {
  const user = await getCurrentUser();
  const b = user?.business;
  if (!b) return false;
  if (!(await allow(`reviewreply:${b.id}`, 60, 60 * 60))) return false;
  return replyBusinessReview(b.id, String(id).slice(0, 64), clip(reply, 600));
}

export async function reportReviewAction(id: string, reason: string): Promise<boolean> {
  const user = await getCurrentUser();
  const b = user?.business;
  if (!b) return false;
  if (!(await allow(`reviewreport:${b.id}`, 20, 24 * 60 * 60))) return false;
  const why = clip(reason, 400);
  const ok = await reportBusinessReview(b.id, String(id).slice(0, 64), why);
  if (ok) await notifyAdmins(`Reseña reportada · ${b.name}`, `El negocio ${b.name} (${b.slug}) reportó la reseña ${id}.\nMotivo: ${why || "(sin motivo)"}`).catch(() => {});
  return ok;
}
