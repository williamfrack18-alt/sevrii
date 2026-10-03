// Everything the public store page shows beyond the basic business row.
// Stored as one JSONB column (businesses.site) and always passed through
// parseSite() so bad or old data can never break a page.

export type FaqItem = { q: string; a: string };

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
