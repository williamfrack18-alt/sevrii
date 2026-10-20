import { marketplaceListings } from "@/lib/marketplace";
import { lookupPlace, milesBetween, nearestPlace } from "@/lib/geo";
import type { Visitor } from "@/lib/reach";

// Public list of published pages for the marketplace on sevrii.com, matched
// to where the visitor is: ?loc=city-or-ZIP (typed), ?lat=&lon= (device),
// ?loc=all (no filter), or else the location of their internet connection.
export const dynamic = "force-dynamic";

function header(req: Request, k: string): string {
  const v = req.headers.get(k) || "";
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

// US territories come from Vercel as their own country code, but US-wide
// online services serve them too: treat them as US (the code stays as state).
const US_TERRITORIES = new Set(["PR", "GU", "VI", "AS", "MP"]);

// Where the internet connection comes from (Vercel headers), country normalized.
function ipLocation(req: Request): { country: string; region: string; city: string; lat: number; lon: number; hasCoords: boolean } {
  let country = header(req, "x-vercel-ip-country").toUpperCase();
  let region = header(req, "x-vercel-ip-country-region").toUpperCase();
  if (US_TERRITORIES.has(country)) {
    region = country;
    country = "US";
  }
  const rawLat = header(req, "x-vercel-ip-latitude");
  const lat = Number(rawLat);
  const lon = Number(header(req, "x-vercel-ip-longitude"));
  return { country, region, city: header(req, "x-vercel-ip-city"), lat, lon, hasCoords: !!rawLat && Number.isFinite(lat) && Number.isFinite(lon) };
}

function ipLabel(ip: ReturnType<typeof ipLocation>): string {
  if (ip.city) return `${ip.city}${ip.region ? `, ${ip.region}` : ""}`;
  return ip.hasCoords ? nearestPlace(ip.lat, ip.lon)?.city ?? "" : ip.region;
}

// Device coordinates farther than this from any known US place are outside the US.
const DEVICE_US_MAX_MILES = 60;

type Detected = { visitor: Visitor | null; all: boolean; notFound?: boolean };

function visitorFrom(req: Request): Detected {
  const url = new URL(req.url);
  const ip = ipLocation(req);
  const loc = (url.searchParams.get("loc") || "").slice(0, 80).trim();
  if (loc === "all") return { visitor: null, all: true };
  if (loc) {
    // "Arlington" alone: prefer the visitor's own state when we know it.
    const p = lookupPlace(loc, ip.country === "US" && ip.region ? ip.region : undefined);
    if (p) return { visitor: { lat: p.lat, lon: p.lon, country: "US", label: `${p.city}, ${p.state}`, source: "typed", state: p.state }, all: false };
    return { visitor: null, all: false, notFound: true };
  }
  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));
  if (url.searchParams.has("lat") && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
    const near = nearestPlace(lat, lon);
    const miles = near ? milesBetween(near, { lat, lon }) : Infinity;
    const ipForeign = !!ip.country && ip.country !== "US";
    // Near a US place: in the US, unless the connection is foreign and the point
    // isn't right at that place (Toronto, Vancouver… are within 60 miles of the US).
    if (near && miles <= DEVICE_US_MAX_MILES && (!ipForeign || miles <= 10)) {
      return { visitor: { lat, lon, country: "US", label: `${near.city}, ${near.state}`, source: "device", state: near.state }, all: false };
    }
    // Farther away (or a foreign connection): the connection's country decides —
    // a US one (rural Alaska, Nevada…) stays US; none at all means unknown, not US.
    // Never labeled with the nearest US city, which may be hundreds of miles away.
    const country = ip.country;
    const label = country === "US" ? ipLabel(ip) : country ? ip.city || country : "";
    return { visitor: { lat, lon, country, label, source: "device", state: country === "US" ? ip.region || undefined : undefined }, all: false };
  }
  // Vercel tells us roughly where the connection comes from.
  if (ip.country && ip.hasCoords) {
    const label = ip.country === "US" ? ipLabel(ip) : ip.city || ip.country;
    return { visitor: { lat: ip.lat, lon: ip.lon, country: ip.country, label, source: "ip", state: ip.country === "US" ? ip.region || undefined : undefined }, all: false };
  }
  return { visitor: null, all: false };
}

export async function GET(req: Request) {
  const lang = new URL(req.url).searchParams.get("lang") === "en" ? "en" : "es";
  try {
    const { visitor, all, notFound } = visitorFrom(req);
    // A typed place we don't know: say so and let the page keep what it shows.
    if (notFound) return Response.json({ notFound: true }, { headers: { "Cache-Control": "private, max-age=60" } });
    const listings = await marketplaceListings(visitor, lang);
    return Response.json(
      {
        listings,
        visitor: visitor ? { label: visitor.label, country: visitor.country, source: visitor.source } : null,
        all,
      },
      // Depends on where the visitor is: never shared between visitors.
      { headers: { "Cache-Control": "private, max-age=60" } }
    );
  } catch (err) {
    console.error("[marketplace]", err instanceof Error ? err.message : err);
    return Response.json({ listings: [], visitor: null, all: false }, { status: 200, headers: { "Cache-Control": "no-store" } });
  }
}
