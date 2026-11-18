"use server";

import { getCurrentUser } from "@/lib/session";
import { allow, clientIp } from "@/lib/guard";
import { limitsFor } from "@/lib/billing";
import { getBusinessBySlug, getUserById, pageStats, patchBusinessSite, recordPageOrder, type PageStats } from "@/lib/db";
import { cleanPixelId } from "@/lib/site";

// A visitor tapped "Pedir" on a service: counted on live pages, never the owner.
export async function pageOrderAction(input: { slug: string }): Promise<void> {
  try {
    const b = await getBusinessBySlug(String(input.slug || "").slice(0, 80));
    if (!b || !b.published) return;
    const viewer = await getCurrentUser().catch(() => null);
    if (viewer?.id === b.userId) return;
    const owner = await getUserById(b.userId);
    if (!owner || !limitsFor(owner).canPublish) return;
    if (!(await allow(`porder:${await clientIp()}:${b.id}`, 20, 60 * 60))) return;
    await recordPageOrder(b.id);
  } catch {
    // numbers never break the page
  }
}

export type PageStatsState = { today: PageStats; week: PageStats; month: PageStats; pixelId: string; published: boolean };

// The owner's page numbers: today, the last 7 days and the last 30 days.
export async function pageStatsAction(): Promise<PageStatsState | null> {
  const user = await getCurrentUser();
  const b = user?.business;
  if (!b) return null;
  const [today, week, month] = await Promise.all([pageStats(b.id, 1), pageStats(b.id, 7), pageStats(b.id, 30)]);
  return { today, week, month, pixelId: b.site.metaPixelId, published: Boolean(b.published) };
}

// The owner's own Meta pixel for their page ("" removes it).
export async function saveMetaPixelAction(raw: string): Promise<{ ok: boolean; pixelId: string; error?: "invalid" | "rate" }> {
  const user = await getCurrentUser();
  const b = user?.business;
  if (!b) return { ok: false, pixelId: "", error: "invalid" };
  if (!(await allow(`pixel:${b.id}`, 20, 60 * 60))) return { ok: false, pixelId: b.site.metaPixelId, error: "rate" };
  const text = String(raw ?? "").trim();
  const id = cleanPixelId(text);
  if (text && !id) return { ok: false, pixelId: b.site.metaPixelId, error: "invalid" };
  await patchBusinessSite(b.id, { metaPixelId: id });
  return { ok: true, pixelId: id };
}
