import { marketplaceListings } from "@/lib/marketplace";

// Public list of published pages for the marketplace on sevrii.com.
// Cached for a minute at the edge so the homepage stays fast.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const listings = await marketplaceListings();
    return Response.json(
      { listings },
      { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } }
    );
  } catch (err) {
    console.error("[marketplace]", err instanceof Error ? err.message : err);
    return Response.json({ listings: [] }, { status: 200, headers: { "Cache-Control": "no-store" } });
  }
}
