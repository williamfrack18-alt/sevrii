"use server";

// The owner edits their own page from the page itself ("Editar mi página"):
// change a text, move a section up or down, hide or show it, pick a design.
// Every action checks that the page (by its slug) belongs to the signed-in
// owner, and every value passes through the same limits as the AI editor.

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/session";
import { getBusinessBySlug, getServiceById, mergeBusinessSite, updateBusinessDetails, updateService, type BusinessRow } from "@/lib/db";
import { HIDEABLE, LIMITS, PAGE_DESIGNS, PAGE_SECTIONS, sectionOrder, type Hideable, type PageDesign, type PageSection, type Point } from "@/lib/site";

async function owned(slug: string): Promise<BusinessRow | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const b = await getBusinessBySlug(String(slug).slice(0, 120));
  return b && b.userId === user.id ? b : null;
}

const clip = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\r/g, "").trim().slice(0, max) : "");
const done = (slug: string) => {
  revalidatePath(`/site/${slug}`);
  revalidatePath("/dashboard");
  return { ok: true as const };
};
const fail = { ok: false as const };

export type EditField = "headline" | "pitch" | "keyPoint" | "step" | "faq" | "ctaTitle" | "ctaText" | "service";

export async function saveSiteTextAction(slug: string, field: EditField, value: string, opts: { index?: number; sub?: string; id?: string } = {}): Promise<{ ok: boolean }> {
  const b = await owned(slug);
  if (!b) return fail;
  const site = b.site;
  const idx = Number.isInteger(opts.index) ? (opts.index as number) : -1;

  switch (field) {
    case "headline": {
      const v = clip(value, LIMITS.headline);
      if (!v) return fail;
      await mergeBusinessSite(b.id, site, { headline: v });
      return done(b.slug);
    }
    case "pitch": {
      const v = clip(value, LIMITS.pitch);
      if (!v) return fail;
      await updateBusinessDetails(b.id, { pitch: v });
      return done(b.slug);
    }
    case "ctaTitle":
    case "ctaText": {
      const v = clip(value, field === "ctaTitle" ? LIMITS.ctaTitle : LIMITS.ctaText);
      if (!v) return fail;
      await mergeBusinessSite(b.id, site, { [field]: v });
      return done(b.slug);
    }
    case "keyPoint":
    case "step": {
      const key = field === "keyPoint" ? "keyPoints" : "steps";
      const list: Point[] =
        key === "keyPoints" && site.keyPoints.length === 0 ? site.highlights.map((h) => ({ title: "", text: h })) : [...site[key]];
      if (idx < 0 || idx >= list.length) return fail;
      const sub = opts.sub === "title" ? "title" : "text";
      const v = clip(value, sub === "title" ? LIMITS.pointTitle : LIMITS.pointText);
      if (!v) return fail;
      list[idx] = { ...list[idx], [sub]: v };
      await mergeBusinessSite(b.id, site, { [key]: list });
      return done(b.slug);
    }
    case "faq": {
      if (idx < 0 || idx >= site.faq.length) return fail;
      const sub = opts.sub === "a" ? "a" : "q";
      const v = clip(value, sub === "a" ? LIMITS.faqA : LIMITS.faqQ);
      if (!v) return fail;
      const faq = site.faq.map((f, i) => (i === idx ? { ...f, [sub]: v } : f));
      await mergeBusinessSite(b.id, site, { faq });
      return done(b.slug);
    }
    case "service": {
      const sv = opts.id ? await getServiceById(String(opts.id)) : undefined;
      if (!sv || sv.businessId !== b.id) return fail;
      if (opts.sub === "name") {
        const v = clip(value, LIMITS.serviceName);
        if (!v) return fail;
        await updateService(sv.id, { name: v });
      } else if (opts.sub === "price") {
        await updateService(sv.id, { price: clip(value, LIMITS.servicePrice) || null });
      } else if (opts.sub === "description") {
        await updateService(sv.id, { description: clip(value, LIMITS.serviceDescription) || null });
      } else return fail;
      return done(b.slug);
    }
  }
  return fail;
}

const isSection = (x: unknown): x is PageSection => (PAGE_SECTIONS as readonly string[]).includes(String(x));

// Moves a section one place up or down among the sections the page shows
// (`peers`, in the order the owner sees them).
export async function moveSectionAction(slug: string, section: string, dir: number, peers: string[]): Promise<{ ok: boolean }> {
  const b = await owned(slug);
  if (!b || !isSection(section) || (dir !== -1 && dir !== 1)) return fail;
  const order = sectionOrder(b.site.order);
  const shown = order.filter((k) => peers.includes(k));
  const at = shown.indexOf(section);
  const other = shown[at + dir];
  if (at < 0 || !other) return fail;
  const next = [...order];
  const a = next.indexOf(section);
  const c = next.indexOf(other);
  [next[a], next[c]] = [next[c], next[a]];
  await mergeBusinessSite(b.id, b.site, { order: next });
  return done(b.slug);
}

export async function toggleSectionAction(slug: string, section: string, hide: boolean): Promise<{ ok: boolean }> {
  const b = await owned(slug);
  if (!b || !(HIDEABLE as readonly string[]).includes(section)) return fail;
  const part = section as Hideable;
  const hidden = hide ? [...new Set([...b.site.hidden, part])] : b.site.hidden.filter((x) => x !== part);
  await mergeBusinessSite(b.id, b.site, { hidden });
  return done(b.slug);
}

export async function setDesignAction(slug: string, design: string): Promise<{ ok: boolean }> {
  const b = await owned(slug);
  if (!b || !(PAGE_DESIGNS as readonly string[]).includes(design)) return fail;
  await mergeBusinessSite(b.id, b.site, { design: design as PageDesign });
  return done(b.slug);
}
