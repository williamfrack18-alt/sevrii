"use server";

import { campaignStats, listCampaigns, type CampaignStats } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { siteUrl } from "@/lib/billing";
import { campaignLink } from "@/lib/campaignLink";

export type CampaignResult = {
  id: string;
  title: string;
  link: string;
  stats: CampaignStats; // all time
  week: CampaignStats; // last 7 days
};

export type CampaignResults = { slug: string; campaigns: CampaignResult[] };

const ZERO: CampaignStats = { views: 0, chats: 0, contacts: 0 };

// The owner's campaigns (current project) with their tracking link and numbers.
export async function getCampaignResultsAction(): Promise<CampaignResults | null> {
  const user = await getCurrentUser();
  const b = user?.business;
  if (!b) return null;
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [campaigns, all, week] = await Promise.all([listCampaigns(b.id), campaignStats(b.id), campaignStats(b.id, weekAgo)]);
  const base = siteUrl();
  return {
    slug: b.slug,
    campaigns: campaigns.map((c) => ({
      id: c.id,
      title: c.title,
      link: campaignLink(b.slug, c.id, base),
      stats: all[c.id] ?? { ...ZERO },
      week: week[c.id] ?? { ...ZERO },
    })),
  };
}
