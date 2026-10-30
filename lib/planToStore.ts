// Turns an approved Brain expediente into the store page: title, text, key
// points, steps, FAQ, offer and priced packages. Pure (no database, no AI), so
// it is instant, free, and the client can use planFingerprint() too.
// It only copies what the owner approved; it never invents facts. Photos,
// phone, WhatsApp, hours and license number are never touched (the plan
// doesn't have them).

import type { BusinessPlan } from "./plan";
import { LIMITS, type FaqItem, type Offer, type Point } from "./site";

type Lang = "es" | "en";

export type StoreDraft = {
  details: { name?: string; category?: string; city?: string; pitch?: string };
  site: {
    headline: string;
    serviceArea: string;
    licenseState: string;
    noLicenseNeeded: boolean;
    insured: boolean;
    spanish: boolean;
    langs: "" | "es" | "en" | "both";
    ownerName: string;
    yearsInBusiness: number | null;
    keyPoints: Point[];
    steps: Point[];
    faq: FaqItem[];
    offer: Offer | null;
    ctaTitle: string;
    ctaText: string;
    lang: Lang;
  };
  services: { name: string; price: string; description: string }[];
};

// Text saved shortened by an older limit ("…por tu cuenta en tu…") is shown
// whole when the Brain plan still has the full sentence it came from.
export function completeFrom(text: string, plan: { service?: string; promise?: string }): string {
  const t = (text || "").trim();
  if (!t) return t;
  const stem = t.replace(/…$/, "").trim();
  if (stem.length < 12) return t;
  for (const c of [plan.service, plan.promise]) {
    const full = (c || "").trim().replace(/\s+/g, " ");
    if (full.length > stem.length && full.toLowerCase().startsWith(stem.toLowerCase())) return full;
  }
  return t;
}

function cut(s: string, max: number): string {
  const t = (s || "").trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  const slice = t.slice(0, max - 1);
  const space = slice.lastIndexOf(" ");
  return `${(space > max * 0.6 ? slice.slice(0, space) : slice).replace(/[,;:.\s]+$/, "")}…`;
}

// "Fast reply: we answer in 1 hour" → title + text. Without a clear label,
// the whole sentence stays as text (the page shows it fine).
export function splitPoint(s: string): Point {
  const t = (s || "").trim().replace(/\s+/g, " ");
  const m = /^(.{3,48}?)\s*(?::|\s[—–-])\s+(.{3,})$/.exec(t);
  if (m) {
    const text = m[2].charAt(0).toUpperCase() + m[2].slice(1);
    return { title: cut(m[1], LIMITS.pointTitle), text: cut(text, LIMITS.pointText) };
  }
  return { title: "", text: cut(t, LIMITS.pointText) };
}

// Step cards look odd when only some have a title: all titled, or none.
function uniformSteps(steps: string[]): Point[] {
  const split = steps.map(splitPoint);
  return split.every((p) => p.title) ? split : steps.map((x) => ({ title: "", text: cut(x, LIMITS.pointText) }));
}

// Stable short hash of the parts of the plan the page is built from. When it
// changes, the Store tab offers to rebuild the page.
export function planFingerprint(plan: BusinessPlan): string {
  const p = plan.profile;
  const src = JSON.stringify([
    p.businessName, p.city, p.state, p.radiusMiles, p.languages, p.yearsExperience, p.licenseStatus, p.insured, p.zip, p.ownerName, p.yearsOwnBusiness,
    plan.service, plan.serviceIncludes, plan.steps, plan.promise, plan.differentiators,
    plan.packages, plan.offer, plan.noOffer, plan.faq,
  ]);
  let h = 0x811c9dc5;
  for (let i = 0; i < src.length; i++) {
    h ^= src.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function planReadyForStore(plan: BusinessPlan): boolean {
  return plan.stage === "approved" && Boolean(plan.service) && plan.packages.length > 0;
}

export function storeFromPlan(plan: BusinessPlan, lang: Lang): StoreDraft {
  const p = plan.profile;
  const es = lang === "es";
  const city = [p.city, p.state].filter(Boolean).join(", ");
  const area = p.serviceMode === "remote"
    ? p.remoteScope === "world"
      ? es ? "En línea · EE. UU. y otros países" : "Online · US and other countries"
      : p.remoteScope === "state" && p.state
        ? es ? `En línea · solo ${p.state}` : `Online · ${p.state} only`
        : es ? "En línea · todo EE. UU." : "Online · all of the US"
    : city
    ? p.radiusMiles
      ? es
        ? `${city} y ${p.radiusMiles} millas a la redonda`
        : `${city} and ${p.radiusMiles} miles around`
      : city
    : "";
  const pageLang: Lang = p.languages === "en" ? "en" : p.languages === "es" ? "es" : lang;

  const headline = cut(plan.promise && plan.promise.length <= LIMITS.headline ? plan.promise : plan.service, LIMITS.headline);
  const sentence = (x: string) => (x && !/[.!?]$/.test(x.trim()) ? `${x.trim()}.` : x.trim());
  const pitchParts = [plan.promise && headline !== cut(plan.promise, LIMITS.headline) ? plan.promise : "", plan.serviceIncludes]
    .filter(Boolean)
    .map(sentence);
  const pitch = cut(pitchParts.join(" ") || plan.service, LIMITS.pitch);

  const today = new Date().toISOString().slice(0, 10);
  const offer: Offer | null =
    plan.offer && !plan.noOffer && plan.offer.label && (!plan.offer.endsAt || plan.offer.endsAt >= today)
      ? { label: cut(plan.offer.label, LIMITS.offerLabel), oldPrice: "", newPrice: "", endsAt: plan.offer.endsAt }
      : null;

  // The closing title ("¿Necesitas …?") uses the shortest name that fits whole;
  // a long one never gets cut in the middle — it gets a plain question instead.
  const lower = (x: string) => `${x.charAt(0).toLowerCase()}${x.slice(1)}`;
  const shortName = [p.mainService, plan.service].map((x) => (x || "").trim().replace(/[.?!]+$/, "")).filter(Boolean).sort((a, b) => a.length - b.length)[0] || "";
  const ask = shortName ? (es ? `¿Necesitas ${lower(shortName)}?` : `Need ${lower(shortName)}?`) : "";
  const ctaTitle = ask && ask.length <= 70 ? ask : es ? "¿Te ayudamos? Escríbenos" : "Can we help? Message us";
  return {
    details: {
      name: p.businessName ? cut(p.businessName, LIMITS.name) : undefined,
      category: plan.service ? cut(plan.service, 80) : undefined,
      city: p.city ? cut(city, 80) : undefined,
      pitch,
    },
    site: {
      headline,
      serviceArea: cut(area, LIMITS.serviceArea),
      licenseState: p.state ? p.state.slice(0, LIMITS.state) : "",
      noLicenseNeeded: p.licenseStatus === "not_needed",
      insured: p.insured === "yes",
      spanish: p.languages === "es" || p.languages === "both",
      langs: p.languages,
      ownerName: (p.ownerName || "").slice(0, 40),
      // "Years in business" are the years on their own, not their whole experience.
      yearsInBusiness: p.yearsOwnBusiness && p.yearsOwnBusiness > 0 ? p.yearsOwnBusiness : null,
      keyPoints: plan.differentiators.slice(0, LIMITS.keyPoints).map(splitPoint),
      steps: uniformSteps(plan.steps.slice(0, LIMITS.steps)),
      faq: plan.faq.slice(0, LIMITS.faq).map((f) => ({ q: cut(f.q, LIMITS.faqQ), a: cut(f.a, LIMITS.faqA) })).filter((f) => f.q && f.a),
      offer,
      ctaTitle,
      ctaText: es ? "Escríbenos aquí para agendar." : "Message us here to book.",
      lang: pageLang,
    },
    services: plan.packages
      .filter((k) => k.name)
      .slice(0, 6)
      .map((k) => ({
        name: cut(k.name, LIMITS.serviceName),
        price: cut(k.price, LIMITS.servicePrice),
        description: cut(k.includes, LIMITS.serviceDescription),
      })),
  };
}
