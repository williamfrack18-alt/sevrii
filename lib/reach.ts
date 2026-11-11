// Where a business offers its service, and whether it can serve a customer.
// Local = in person within N miles of a city; remote = online (all US, or
// other countries too). Older pages without it are read from their city.
import "server-only";
import type { SiteData } from "./site";
import { lookupPlace, milesBetween, stateCode, US_STATES, type Place } from "./geo";

export type Reach = {
  mode: "local" | "remote" | "unknown";
  scope: "us" | "state" | "world";
  state: string; // remote "state" scope: the state they serve (e.g. TX)
  radius: number;
  base: Place | null;
  // The business's country (ISO-2). Outside the US there is no US place to
  // measure miles from: "us" scope means "their own country".
  country: string;
};

const countryName = (code: string, lang: "es" | "en") => {
  try {
    return new Intl.DisplayNames([lang], { type: "region" }).of(code) || code;
  } catch {
    return code;
  }
};

export function resolveReach(site: SiteData, city: string | null, profile?: { city?: string; state?: string; radiusMiles?: number | null; serviceMode?: string; remoteScope?: string; country?: string }): Reach {
  const country = /^[A-Z]{2}$/.test(profile?.country || "") ? (profile?.country as string) : "US";
  // Outside the US: never look the city up among US places (Madrid → Madrid, NY).
  if (country !== "US") {
    const remote = site.reachMode === "remote" || profile?.serviceMode === "remote";
    const scope = (remote ? site.reachScope || profile?.remoteScope : "") === "world" ? "world" : "us";
    return { mode: remote ? "remote" : "local", scope, state: "", radius: 0, base: null, country };
  }
  return { ...usReach(site, city, profile), country };
}

function usReach(site: SiteData, city: string | null, profile?: { city?: string; state?: string; radiusMiles?: number | null; serviceMode?: string; remoteScope?: string }): Omit<Reach, "country"> {
  if (site.reachMode === "remote") {
    const st = stateCode(site.baseState || "") || "";
    return { mode: "remote", scope: site.reachScope === "state" && !st ? "us" : site.reachScope, state: st, radius: 0, base: null };
  }
  if (site.reachMode === "local" && site.baseLat !== null && site.baseLon !== null) {
    return { mode: "local", scope: "us", state: "", radius: site.reachRadius, base: { city: site.baseCity, state: site.baseState, lat: site.baseLat, lon: site.baseLon } };
  }
  if (profile?.serviceMode === "remote") {
    const st = stateCode(profile.state || "") || "";
    return { mode: "remote", scope: profile.remoteScope === "world" ? "world" : profile.remoteScope === "state" && st ? "state" : "us", state: st, radius: 0, base: null };
  }
  // Older pages: the business city (or the Brain profile city).
  const guess =
    (site.baseCity && lookupPlace(`${site.baseCity}${site.baseState ? `, ${site.baseState}` : ""}`)) ||
    (city && lookupPlace(city)) ||
    (profile?.city && lookupPlace(`${profile.city}${profile.state ? `, ${profile.state}` : ""}`)) ||
    null;
  const radius = site.reachMode === "local" ? site.reachRadius : profile?.radiusMiles || 25;
  return guess ? { mode: "local", scope: "us", state: "", radius, base: guess } : { mode: "unknown", scope: "us", state: "", radius, base: null };
}

// state: the US state code when known (from the place, the device or the connection).
export type Visitor = { lat: number; lon: number; country: string; label: string; source: "ip" | "typed" | "device"; state?: string };

// Does this business serve this customer? (null visitor = we don't know where they are)
export function serves(r: Reach, v: Visitor | null): { ok: boolean; miles: number | null } {
  if (r.mode === "remote") {
    if (r.scope === "world" || !v) return { ok: true, miles: null };
    // One state only: a US visitor in that state (or whose state we don't know).
    if (r.scope === "state") return { ok: v.country === r.country && (!v.state || v.state === r.state), miles: null };
    return { ok: v.country === r.country, miles: null };
  }
  if (!v) return { ok: true, miles: null };
  // In person outside the US (no place to measure from): customers in the same country.
  if (r.country !== "US" && !r.base) return { ok: v.country === r.country, miles: null };
  if (r.mode === "unknown" || !r.base) return { ok: false, miles: null };
  const miles = milesBetween(r.base, v);
  return { ok: miles <= r.radius, miles: Math.round(miles) };
}

export function reachLabel(r: Reach, lang: "es" | "en"): string {
  const es = lang === "es";
  if (r.country !== "US") {
    const name = countryName(r.country, lang);
    if (r.mode === "remote") return r.scope === "world" ? (es ? `En línea · ${name} y otros países` : `Online · ${name} and other countries`) : es ? `En línea · todo ${name}` : `Online · all of ${name}`;
    return "";
  }
  if (r.mode === "remote") {
    if (r.scope === "world") return es ? "En línea · EE. UU. y otros países" : "Online · US and other countries";
    if (r.scope === "state") return es ? `En línea · solo ${US_STATES[r.state] ?? r.state}` : `Online · ${US_STATES[r.state] ?? r.state} only`;
    return es ? "En línea · todo EE. UU." : "Online · all of the US";
  }
  if (r.base) return es ? `${r.base.city}, ${r.base.state} · hasta ${r.radius} millas` : `${r.base.city}, ${r.base.state} · up to ${r.radius} miles`;
  return "";
}
