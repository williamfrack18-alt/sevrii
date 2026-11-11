// Turns an approved Brain expediente into the store page: title, text, key
// points, steps, FAQ, offer and priced packages. Pure (no database, no AI), so
// it is instant, free, and the client can use planFingerprint() too.
// It only copies what the owner approved; it never invents facts. Photos,
// phone, WhatsApp, hours and license number are never touched (the plan
// doesn't have them).

import type { BusinessPlan } from "./plan";
import { LIMITS, type FaqItem, type Offer, type Point } from "./site";
import { stripReasoning } from "./pageText";

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
  // Completed from the texts without their reasoning: "Clases de inglés…" never
  // grows back into "Clases de inglés… — lo elegí porque fuiste profesor".
  for (const c of [plan.service, plan.promise]) {
    const full = stripReasoning(c || "").trim().replace(/\s+/g, " ");
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

function hash(src: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < src.length; i++) {
    h ^= src.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

// The fields pages were fingerprinted with before country, region and how the
// service is delivered reached the page.
function legacyFingerprint(plan: BusinessPlan): string {
  const p = plan.profile;
  return hash(JSON.stringify([
    p.businessName, p.city, p.state, p.radiusMiles, p.languages, p.yearsExperience, p.licenseStatus, p.insured, p.zip, p.ownerName, p.yearsOwnBusiness,
    plan.service, plan.serviceIncludes, plan.steps, plan.promise, plan.differentiators,
    plan.packages, plan.offer, plan.noOffer, plan.faq,
  ]));
}

// Stable short hash of the parts of the plan the page is built from. When it
// changes, the Store tab offers to rebuild the page. Only what reaches the
// page counts (never the growth plan or the channels, which are the owner's).
export function planFingerprint(plan: BusinessPlan): string {
  const p = plan.profile;
  const where = [
    p.serviceMode,
    p.serviceMode === "remote" ? p.remoteScope : "",
    p.country === "US" ? "" : p.country,
    p.state ? "" : p.region,
    p.mainService,
    plan.flowLang,
    p.currentPrice,
  ];
  return `${legacyFingerprint(plan)}.${hash(JSON.stringify(where))}`;
}

// Is the page built from this version of the plan? A page built before the
// second part existed is compared on the first part only, so nobody gets an
// "update your page" banner for a plan that didn't change.
export function pageMatchesPlan(fromPlan: string, plan: BusinessPlan): boolean {
  if (!fromPlan) return false;
  return fromPlan.includes(".") ? fromPlan === planFingerprint(plan) : fromPlan === legacyFingerprint(plan);
}

// The amounts in a price, whatever the currency ("$1,200", "18 €", "$80.000 COP").
const amounts = (x: string) => (x.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, ""));

// A package whose every amount is the price the owner said they charge today
// (profile.currentPrice) is theirs, in any currency: the Brain's check only
// reads "$" amounts, so "18 €" the owner gave would otherwise stay a reference
// and the page would hide their own price.
export function ownerPricedPackages(plan: BusinessPlan): BusinessPlan["packages"] {
  const own = amounts(plan.profile.currentPrice || "");
  if (!own.length) return plan.packages;
  return plan.packages.map((k) => {
    const am = amounts(k.price);
    return k.ref && am.length > 0 && am.every((n) => own.includes(n)) ? { ...k, ref: false } : k;
  });
}

// Outside the US distances are said in km (the Brain keeps them in miles).
export function radiusText(miles: number, us: boolean, es: boolean): string {
  if (us) return es ? `${miles} millas a la redonda` : `${miles} miles around`;
  const km = miles * 1.609;
  const n = km < 10 ? Math.max(1, Math.round(km)) : Math.round(km / 5) * 5;
  return es ? `${n} km a la redonda` : `${n} km around`;
}

// An approved strategy can have no packages (the Brain's single confirmation
// lets an empty part through): its headline, texts and FAQ still build the page,
// and the Store chat asks for the packages, instead of leaving it empty.
export function planReadyForStore(plan: BusinessPlan): boolean {
  return plan.stage === "approved" && Boolean(plan.service);
}

export function storeFromPlan(planIn: BusinessPlan, flowLangIn: Lang): StoreDraft {
  // The page speaks the language the flow ran in: its texts were written in
  // it, so its fixed labels are too (never Spanish texts under English labels).
  const lang: Lang = planIn.flowLang || flowLangIn;
  // Reasoning meant for the owner ("te conviene porque…") never reaches customers.
  const plan: BusinessPlan = {
    ...planIn,
    // The service title and package names reach the page too (headline,
    // category, cards), so they lose their reasoning like the texts do.
    service: stripReasoning(planIn.service),
    promise: stripReasoning(planIn.promise),
    serviceIncludes: stripReasoning(planIn.serviceIncludes),
    steps: planIn.steps.map(stripReasoning).filter(Boolean),
    differentiators: planIn.differentiators.map(stripReasoning).filter(Boolean),
    faq: planIn.faq.map((f) => ({ q: f.q, a: stripReasoning(f.a) })).filter((f) => f.a),
    packages: ownerPricedPackages(planIn).map((k) => ({ ...k, name: stripReasoning(k.name), includes: stripReasoning(k.includes) })),
    offer: planIn.offer ? { ...planIn.offer, label: stripReasoning(planIn.offer.label) } : null,
  };
  const p = plan.profile;
  const es = lang === "es";
  // Any country: the US state, or the region outside the US.
  const region = p.state || p.region;
  const us = !p.country || p.country === "US";
  const nation = us ? (es ? "EE. UU." : "the US") : countryLabel(p.country, lang);
  const city = [p.city, region].filter(Boolean).join(", ");
  // The place customers read in the page header: "Brooklyn, NY" in the US;
  // elsewhere the city with its region (unless it repeats the city) and country.
  const fold = (x: string) => x.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const regionShown = region && !fold(region).includes(fold(p.city)) && !fold(p.city).includes(fold(region)) ? region : "";
  const place = us ? city : [p.city, regionShown, p.city ? nation : ""].filter(Boolean).join(", ");
  const area = p.serviceMode === "remote"
    ? p.remoteScope === "world"
      ? es ? `En línea · ${nation} y otros países` : `Online · ${nation} and other countries`
      : p.remoteScope === "state" && region
        ? es ? `En línea · solo ${region}` : `Online · ${region} only`
        : es ? `En línea · todo ${nation}` : `Online · all of ${nation}`
    : city
    ? p.radiusMiles
      ? `${city} ${es ? "y" : "and"} ${radiusText(p.radiusMiles, us, es)}`
      : city
    : "";
  const pageLang: Lang = lang;

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
      city: p.city ? cut(place, 80) : undefined,
      pitch,
    },
    site: {
      headline,
      serviceArea: cut(area, LIMITS.serviceArea),
      licenseState: p.state ? p.state.slice(0, LIMITS.state) : "",
      noLicenseNeeded: p.licenseStatus === "not_needed",
      insured: p.insured === "yes",
      // "Se habla español" sells in the US (or on an English page); in Madrid or
      // Bogotá it goes without saying. Both languages are worth saying anywhere.
      spanish: p.languages === "both" || (p.languages === "es" && (us || lang === "en")),
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
        // A market reference is not the owner's price: the page shows none
        // until they confirm theirs (the Store chat asks for it).
        price: k.ref ? "" : cut(k.price, LIMITS.servicePrice),
        description: cut(k.includes, LIMITS.serviceDescription),
      })),
  };
}

// The Store chat is about to save a price equal to a package's market
// reference (ref) that the owner never gave: not in anything they wrote in the
// chat, nor a plain yes ("yes") right after the assistant asked about it.
export function refPriceUnconfirmed(
  price: string,
  packages: BusinessPlan["packages"],
  said: { ownerSaid?: string; lastAssistant?: string; yes?: boolean }
): boolean {
  const nums = amounts(price);
  if (!nums.length) return false;
  if (!packages.some((k) => k.ref && nums.every((n) => amounts(k.price).includes(n)))) return false;
  // Links (uploaded photos) carry digits that are no price.
  const owner = amounts((said.ownerSaid ?? "").replace(/https?:\/\/\S+/g, " "));
  if (nums.every((n) => owner.includes(n))) return false;
  return !(said.yes && nums.every((n) => amounts(said.lastAssistant ?? "").includes(n)));
}

// "CO" → "Colombia" in the page's language.
function countryLabel(code: string, lang: "es" | "en"): string {
  try {
    return new Intl.DisplayNames([lang], { type: "region" }).of(code) || code;
  } catch {
    return code;
  }
}
