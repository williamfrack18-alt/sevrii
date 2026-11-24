import type { MetadataRoute } from "next";
import { listMarketplaceRows } from "@/lib/db";
import { effectivePlan } from "@/lib/billing";
import { PLANS } from "@/lib/plans";

const BASE = "https://www.sevrii.com";
// Sevrii's own pages, each in Spanish (/) and English (/en/).
const PAGES: { path: string; priority: number }[] = [
  { path: "", priority: 1 },
  { path: "ofrecerservicios", priority: 0.9 },
  { path: "precios", priority: 0.8 },
  { path: "afiliados", priority: 0.8 },
  { path: "agentes-de-servicios", priority: 0.7 },
  { path: "agentes", priority: 0.7 },
  { path: "sevriirobotics", priority: 0.4 },
  { path: "matheus-credito", priority: 0.4 },
  { path: "terminos", priority: 0.2 },
  { path: "privacidad", priority: 0.2 },
];

// Rebuilt every hour, so newly published pages show up on their own.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const out: MetadataRoute.Sitemap = [];
  for (const p of PAGES) {
    const es = p.path ? `${BASE}/${p.path}` : `${BASE}/`;
    const en = p.path ? `${BASE}/en/${p.path}` : `${BASE}/en`;
    const alternates = { languages: { es, en, "x-default": es } };
    out.push({ url: es, changeFrequency: "weekly", priority: p.priority, alternates });
    out.push({ url: en, changeFrequency: "weekly", priority: Math.max(0.1, p.priority - 0.1), alternates });
  }
  // Every published business page whose owner's plan still publishes (the
  // same ones the marketplace lists). Job-seeker pages are shared by link only.
  try {
    for (const r of await listMarketplaceRows(5000)) {
      const plan = effectivePlan({ email: r.email, plan: r.plan ?? undefined, planStatus: r.planStatus ?? undefined, googleSub: r.googleSub, emailVerifiedAt: r.emailVerifiedAt, planRenewsAt: r.planRenewsAt });
      if (!PLANS[plan].limits.canPublish) continue;
      out.push({ url: `${BASE}/site/${r.slug}`, changeFrequency: "weekly", priority: 0.6 });
    }
  } catch (err) {
    console.error("[sitemap] business pages", (err as Error)?.message);
  }
  return out;
}
