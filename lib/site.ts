// Everything the public store page shows beyond the basic business row.
// Stored as one JSONB column (businesses.site) and always passed through
// parseSite() so bad or old data can never break a page.

export type FaqItem = { q: string; a: string };
export type Point = { title: string; text: string };
export type Offer = { label: string; oldPrice: string; newPrice: string; endsAt: string };

export type SiteData = {
  headline: string;
  phone: string; // E.164, e.g. +13055550123 ("" = none)
  textEnabled: boolean; // the phone number accepts SMS
  serviceArea: string;
  hours: string;
  licenseNumber: string;
  licenseState: string;
  noLicenseNeeded: boolean; // owner says their trade needs no license in their state
  insured: boolean; // declared by the owner
  spanish: boolean; // "Se habla español"
  yearsInBusiness: number | null;
  googleReviewsUrl: string;
  highlights: string[];
  keyPoints: Point[]; // the checklist in the buy box
  offer: Offer | null; // a REAL promotion given by the owner
  steps: Point[]; // "how we work"
  features: string[]; // trust bar
  ctaTitle: string;
  ctaText: string;
  ctaNote: string; // micro line under the buttons
  disclaimer: string;
  faq: FaqItem[];
  logoUrl: string;
  coverUrl: string;
  gallery: string[];
  lang: "es" | "en";
};

export const EMPTY_SITE: SiteData = {
  headline: "",
  phone: "",
  textEnabled: true,
  serviceArea: "",
  hours: "",
  licenseNumber: "",
  licenseState: "",
  noLicenseNeeded: false,
  insured: false,
  spanish: false,
  yearsInBusiness: null,
  googleReviewsUrl: "",
  highlights: [],
  keyPoints: [],
  offer: null,
  steps: [],
  features: [],
  ctaTitle: "",
  ctaText: "",
  ctaNote: "",
  disclaimer: "",
  faq: [],
  logoUrl: "",
  coverUrl: "",
  gallery: [],
  lang: "en",
};

export const LIMITS = {
  headline: 90,
  pitch: 400,
  serviceArea: 120,
  hours: 160,
  license: 40,
  state: 30,
  url: 500,
  highlight: 80,
  highlights: 4,
  pointTitle: 50,
  pointText: 180,
  keyPoints: 5,
  steps: 4,
  feature: 40,
  features: 5,
  offerLabel: 80,
  offerPrice: 30,
  ctaTitle: 90,
  ctaText: 180,
  ctaNote: 90,
  disclaimer: 500,
  faqQ: 140,
  faqA: 500,
  faq: 8,
  gallery: 8,
  name: 80,
  serviceName: 80,
  servicePrice: 40,
  serviceDescription: 240,
};

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

export function safeUrl(v: unknown): string {
  const s = str(v, LIMITS.url);
  if (!s) return "";
  try {
    const u = new URL(s);
    return u.protocol === "https:" ? u.toString() : "";
  } catch {
    return "";
  }
}

export function parseSite(raw: unknown): SiteData {
  let obj: Record<string, unknown> = {};
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      obj = {};
    }
  } else if (raw && typeof raw === "object") {
    obj = raw as Record<string, unknown>;
  }
  const years = Number(obj.yearsInBusiness);
  return {
    headline: str(obj.headline, LIMITS.headline),
    phone: normalizePhone(str(obj.phone, 30)) ?? "",
    textEnabled: obj.textEnabled === undefined ? true : Boolean(obj.textEnabled),
    serviceArea: str(obj.serviceArea, LIMITS.serviceArea),
    hours: str(obj.hours, LIMITS.hours),
    licenseNumber: str(obj.licenseNumber, LIMITS.license),
    licenseState: str(obj.licenseState, LIMITS.state),
    noLicenseNeeded: Boolean(obj.noLicenseNeeded),
    insured: Boolean(obj.insured),
    spanish: Boolean(obj.spanish),
    yearsInBusiness: Number.isFinite(years) && years > 0 && years < 100 ? Math.round(years) : null,
    googleReviewsUrl: safeUrl(obj.googleReviewsUrl),
    highlights: (Array.isArray(obj.highlights) ? obj.highlights : [])
      .map((h) => str(h, LIMITS.highlight))
      .filter(Boolean)
      .slice(0, LIMITS.highlights),
    keyPoints: parsePoints(obj.keyPoints, LIMITS.keyPoints),
    offer: parseOffer(obj.offer),
    steps: parsePoints(obj.steps, LIMITS.steps),
    features: (Array.isArray(obj.features) ? obj.features : [])
      .map((h) => str(h, LIMITS.feature))
      .filter(Boolean)
      .slice(0, LIMITS.features),
    ctaTitle: str(obj.ctaTitle, LIMITS.ctaTitle),
    ctaText: str(obj.ctaText, LIMITS.ctaText),
    ctaNote: str(obj.ctaNote, LIMITS.ctaNote),
    disclaimer: str(obj.disclaimer, LIMITS.disclaimer),
    faq: (Array.isArray(obj.faq) ? obj.faq : [])
      .map((f) => {
        const o = (f ?? {}) as Record<string, unknown>;
        return { q: str(o.q, LIMITS.faqQ), a: str(o.a, LIMITS.faqA) };
      })
      .filter((f) => f.q && f.a)
      .slice(0, LIMITS.faq),
    logoUrl: safeUrl(obj.logoUrl),
    coverUrl: safeUrl(obj.coverUrl),
    gallery: (Array.isArray(obj.gallery) ? obj.gallery : [])
      .map((g) => safeUrl(g))
      .filter(Boolean)
      .slice(0, LIMITS.gallery),
    lang: obj.lang === "en" ? "en" : "es",
  };
}

function parsePoints(raw: unknown, max: number): Point[] {
  return (Array.isArray(raw) ? raw : [])
    .map((p) => {
      if (typeof p === "string") return { title: "", text: str(p, LIMITS.pointText) };
      const o = (p ?? {}) as Record<string, unknown>;
      return { title: str(o.title, LIMITS.pointTitle), text: str(o.text, LIMITS.pointText) };
    })
    .filter((p) => p.title || p.text)
    .slice(0, max);
}

function parseOffer(raw: unknown): Offer | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const label = str(o.label, LIMITS.offerLabel);
  if (!label) return null;
  const ends = str(o.endsAt, 40);
  const endsAt = ends && !Number.isNaN(Date.parse(ends)) ? new Date(ends).toISOString() : "";
  return { label, oldPrice: str(o.oldPrice, LIMITS.offerPrice), newPrice: str(o.newPrice, LIMITS.offerPrice), endsAt };
}

// An offer is shown only while it's real: no end date, or an end date still ahead.
export function activeOffer(site: SiteData, now = Date.now()): Offer | null {
  if (!site.offer) return null;
  if (site.offer.endsAt && Date.parse(site.offer.endsAt) <= now) return null;
  return site.offer;
}

// What the page still lacks to really sell — the chat asks for these, in order.
export function missingForSales(opts: {
  category: string;
  whatsapp: string | null;
  site: SiteData;
  serviceCount: number;
  pricedServices: number;
}): string[] {
  const s = opts.site;
  const m: string[] = [];
  if (opts.serviceCount === 0) m.push("services");
  else if (opts.pricedServices === 0) m.push("prices");
  if (!s.phone && !normalizePhone(opts.whatsapp)) m.push("contact");
  if (s.gallery.length === 0 && !s.coverUrl) m.push("photos");
  if (s.keyPoints.length === 0) m.push("keyPoints");
  if (!s.offer) m.push("offer (ask; it's fine to have none)");
  if (isLicensedTrade(opts.category) && !s.licenseNumber && !s.noLicenseNeeded) m.push("license");
  if (!s.serviceArea) m.push("serviceArea");
  if (!s.hours) m.push("hours");
  if (s.steps.length === 0) m.push("steps (how they work)");
  if (s.faq.length === 0) m.push("faq");
  return m;
}

// ---------- Phones ----------
// US-first: a 10-digit number gets +1; "+..." keeps its own country code.
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const raw = input.trim();
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  if (raw.startsWith("+")) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  return null;
}

export function formatPhone(e164: string): string {
  const d = e164.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) {
    return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  }
  return e164;
}

export function telHref(e164: string): string {
  return `tel:${e164}`;
}

export function smsHref(e164: string, body?: string): string {
  return body ? `sms:${e164}?&body=${encodeURIComponent(body)}` : `sms:${e164}`;
}

export function waHref(e164: string, text?: string): string {
  const d = e164.replace(/\D/g, "");
  return text ? `https://wa.me/${d}?text=${encodeURIComponent(text)}` : `https://wa.me/${d}`;
}

// ---------- Colors ----------
// Pick white or near-black text for a given background so buttons stay readable.
export function readableTextOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  // Contrast vs white = 1.05 / (L + 0.05); prefer white when it reaches 4.5:1.
  return 1.05 / (L + 0.05) >= 4.5 ? "#ffffff" : "#111111";
}

// ---------- Licensed trades ----------
// Trades that usually need a state license in the US. In California the
// license number must appear in all advertising for licensed work.
const LICENSED = /(hvac|air.?cond|heating|electric|plumb|roof|contractor|construct|remodel|handyman|pest|aire acond|calefacci|electricist|plomer|techad|contratist|construcci|remodela|fumiga)/i;

export function isLicensedTrade(category: string): boolean {
  return LICENSED.test(category || "");
}

// What still blocks publishing. Empty array = ready.
export type PublishGap = "contact" | "services" | "license";

export function publishGaps(opts: {
  category: string;
  whatsapp: string | null;
  site: SiteData;
  serviceCount: number;
}): PublishGap[] {
  const gaps: PublishGap[] = [];
  if (!opts.site.phone && !normalizePhone(opts.whatsapp)) gaps.push("contact");
  if (opts.serviceCount === 0) gaps.push("services");
  if (isLicensedTrade(opts.category) && !opts.site.licenseNumber && !opts.site.noLicenseNeeded) gaps.push("license");
  return gaps;
}

// ---------- Theme from the business color ----------
// The store template (same look as the Matheus Crédito page) derives its
// gradient and tints from one accent color.
type RGB = [number, number, number];
function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  const n = m ? parseInt(m[1], 16) : 0x234f36;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mixRgb(c: RGB, target: RGB, t: number): RGB {
  return [0, 1, 2].map((i) => Math.round(c[i] + (target[i] - c[i]) * t)) as RGB;
}
const css = (c: RGB) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;

export function storeTheme(accent: string): Record<string, string> {
  const hex = /^#[0-9a-f]{6}$/i.test(accent) && accent.toLowerCase() !== "#122118" ? accent : "#234f36";
  const base = hexToRgb(hex);
  const W: RGB = [255, 255, 255];
  const K: RGB = [0, 0, 0];
  const light = mixRgb(base, W, 0.35);
  return {
    "--accent-grad": `radial-gradient(ellipse 70% 300% at 50% 50%, ${css(mixRgb(base, W, 0.1))} 0%, ${css(mixRgb(base, K, 0.45))} 55%, ${css(mixRgb(base, K, 0.85))} 100%)`,
    "--accent-grad-solid": css(base),
    "--header-grad": `radial-gradient(ellipse 70% 300% at 50% 50%, ${css(mixRgb(base, K, 0.55))} 0%, ${css(mixRgb(base, K, 0.75))} 55%, ${css(mixRgb(base, K, 0.95))} 100%)`,
    "--accent-bg": `rgba(${light[0]}, ${light[1]}, ${light[2]}, 0.13)`,
    "--accent-border": `rgba(${light[0]}, ${light[1]}, ${light[2]}, 0.4)`,
    "--surface": css(mixRgb(base, W, 0.94)),
    "--surface-2": css(mixRgb(base, W, 0.89)),
  };
}
