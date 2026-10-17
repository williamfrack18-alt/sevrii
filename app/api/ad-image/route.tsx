import { campaignBelongs, listCampaigns, listServices } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { allow } from "@/lib/guard";
import { activeOffer } from "@/lib/site";
import { cleanCampaignId } from "@/lib/campaignLink";
import { AD_SIZES, adFont, adPhotoData, renderAdImage, type AdSize } from "@/lib/adImage";

// Ready-to-upload ad images for a campaign:
//   /api/ad-image?campaign=<id>&size=square|story&photo=<n>
// n is the index in [site.coverUrl, ...site.gallery] (empty ones left out).
// Only the signed-in owner, for a campaign of their current project.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(status: number, msg: string) {
  return new Response(msg, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const campaignId = cleanCampaignId(q.get("campaign"));
  const sizeParam = q.get("size") || "square";
  const photoParam = q.get("photo") || "0";
  if (!campaignId || !(sizeParam in AD_SIZES) || !/^\d{1,2}$/.test(photoParam)) return fail(400, "Bad request");
  const size = sizeParam as AdSize;
  const photoIndex = Number(photoParam);

  const user = await getCurrentUser().catch(() => null);
  const business = user?.business;
  if (!user || !business) return fail(404, "Not found");
  if (!(await allow(`adimg:${user.id}`, 80, 10 * 60))) return fail(429, "Too many requests");

  try {
    if (!(await campaignBelongs(business.id, campaignId))) return fail(404, "Not found");
    const [campaigns, services] = await Promise.all([listCampaigns(business.id), listServices(business.id)]);
    const campaign = campaigns.find((c) => c.id === campaignId);
    if (!campaign) return fail(404, "Not found");

    const site = business.site;
    const spec = campaign.spec;
    const lang: "es" | "en" = spec?.language === "en" || spec?.language === "es" ? spec.language : site.lang === "en" ? "en" : "es";
    const headline = spec?.ads?.find((a) => a.headline?.trim())?.headline || site.headline || campaign.title || business.name;
    const offer = activeOffer(site);
    const featured = services.find((s) => s.featured && s.price) || services.find((s) => s.price);
    const priceLine = offer ? [offer.label, offer.newPrice].filter(Boolean).join(" · ") : featured ? `${featured.name} · ${featured.price}` : "";

    const photos = [site.coverUrl, ...site.gallery].filter(Boolean);
    const [photo, font] = await Promise.all([adPhotoData(photos[photoIndex] || ""), adFont()]);

    const png = await renderAdImage({ size, businessName: business.name, headline, priceLine, accent: business.accentColor, lang, photo, font });
    const filename = `sevrii-${business.slug}-${size}-${photoIndex + 1}.png`.replace(/[^A-Za-z0-9._-]/g, "-");
    return new Response(png, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    console.error("[ad-image] failed", (err as Error)?.message);
    return fail(500, "Could not render the image");
  }
}
