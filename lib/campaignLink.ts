// The tracking link of a campaign: the business page with ?c=<campaignId>.
// Visits, chats and contacts that come through it count for that campaign.
// Pure and client-safe (no server imports).

export const DEFAULT_SITE_BASE = "https://www.sevrii.com";

export function campaignLink(slug: string, campaignId: string, base: string = DEFAULT_SITE_BASE): string {
  const root = (base || DEFAULT_SITE_BASE).replace(/\/+$/, "");
  return `${root}/site/${encodeURIComponent(slug)}?c=${encodeURIComponent(campaignId)}`;
}

// A campaign id as it may arrive in a URL or from the browser (ids are short tokens).
export function cleanCampaignId(v: unknown): string {
  if (typeof v !== "string") return "";
  const s = v.trim();
  return /^[A-Za-z0-9_-]{1,64}$/.test(s) ? s : "";
}
