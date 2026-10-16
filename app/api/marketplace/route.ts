import { marketplaceListings } from "@/lib/marketplace";
import { lookupPlace, nearestPlace } from "@/lib/geo";
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

function visitorFrom(req: Request): { visitor: Visitor | null; all: boolean } {
  const url = new URL(req.url);
  const loc = (url.searchParams.get("loc") || "").slice(0, 80).trim();
  if (loc === "all") return { visitor: null, all: true };
  if (loc) {
    const p = lookupPlace(loc);
    if (p) return { visitor: { lat: p.lat, lon: p.lon, country: "US", label: `${p.city}, ${p.state}`, source: "typed" }, all: false };
  }
  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));
  if (url.searchParams.has("lat") && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
    const near = nearestPlace(lat, lon);
    return { visitor: { lat, lon, country: "US", label: near ? `${near.city}, ${near.state}` : "", source: "device" }, all: false };
  }
  // Vercel tells us roughly where the connection comes from.
  const country = header(req, "x-vercel-ip-country");
  const ilat = Number(header(req, "x-vercel-ip-latitude"));
  const ilon = Number(header(req, "x-vercel-ip-longitude"));
  if (country && Number.isFinite(ilat) && Number.isFinite(ilon) && header(req, "x-vercel-ip-latitude")) {
    const city = header(req, "x-vercel-ip-city");
    const region = header(req, "x-vercel-ip-country-region");
    const label = country === "US" ? (city ? `${city}${region ? `, ${region}` : ""}` : nearestPlace(ilat, ilon)?.city ?? "") : city || country;
    return { visitor: { lat: ilat, lon: ilon, country, label, source: "ip" }, all: false };
  }
  return { visitor: null, all: false };
}

export async function GET(req: Request) {
  const lang = new URL(req.url).searchParams.get("lang") === "en" ? "en" : "es";
  try {
    const { visitor, all } = visitorFrom(req);
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
