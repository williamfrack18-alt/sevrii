// Where a business offers its service, and whether it can serve a customer.
// Local = in person within N miles of a city; remote = online (all US, or
// other countries too). Older pages without it are read from their city.
import "server-only";
import type { SiteData } from "./site";
import { lookupPlace, milesBetween, type Place } from "./geo";

export type Reach = {
  mode: "local" | "remote" | "unknown";
  scope: "us" | "world";
  radius: number;
  base: Place | null;
};

export function resolveReach(site: SiteData, city: string | null, profile?: { city?: string; state?: string; radiusMiles?: number | null; serviceMode?: string; remoteScope?: string }): Reach {
  if (site.reachMode === "remote") return { mode: "remote", scope: site.reachScope, radius: 0, base: null };
  if (site.reachMode === "local" && site.baseLat !== null && site.baseLon !== null) {
    return { mode: "local", scope: "us", radius: site.reachRadius, base: { city: site.baseCity, state: site.baseState, lat: site.baseLat, lon: site.baseLon } };
  }
  if (profile?.serviceMode === "remote") return { mode: "remote", scope: profile.remoteScope === "world" ? "world" : "us", radius: 0, base: null };
  // Older pages: the business city (or the Brain profile city).
  const guess =
    (site.baseCity && lookupPlace(`${site.baseCity}${site.baseState ? `, ${site.baseState}` : ""}`)) ||
    (city && lookupPlace(city)) ||
    (profile?.city && lookupPlace(`${profile.city}${profile.state ? `, ${profile.state}` : ""}`)) ||
    null;
  const radius = site.reachMode === "local" ? site.reachRadius : profile?.radiusMiles || 25;
  return guess ? { mode: "local", scope: "us", radius, base: guess } : { mode: "unknown", scope: "us", radius, base: null };
}

export type Visitor = { lat: number; lon: number; country: string; label: string; source: "ip" | "typed" | "device" };

// Does this business serve this customer? (null visitor = we don't know where they are)
export function serves(r: Reach, v: Visitor | null): { ok: boolean; miles: number | null } {
  if (r.mode === "remote") return { ok: r.scope === "world" || !v || v.country === "US", miles: null };
  if (!v) return { ok: true, miles: null };
  if (r.mode === "unknown" || !r.base) return { ok: false, miles: null };
  const miles = milesBetween(r.base, v);
  return { ok: miles <= r.radius, miles: Math.round(miles) };
}

export function reachLabel(r: Reach, lang: "es" | "en"): string {
  const es = lang === "es";
  if (r.mode === "remote") return r.scope === "world" ? (es ? "En línea · EE. UU. y otros países" : "Online · US and other countries") : es ? "En línea · todo EE. UU." : "Online · all of the US";
  if (r.base) return es ? `${r.base.city}, ${r.base.state} · hasta ${r.radius} millas` : `${r.base.city}, ${r.base.state} · up to ${r.radius} miles`;
  return "";
}
