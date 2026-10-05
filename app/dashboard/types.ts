import type { SiteData } from "@/lib/site";
import type { MarketingData, CampaignSpec } from "@/lib/marketing";
import type { BusinessRow, ProjectSummary } from "@/lib/db";
import type { BusinessPlan } from "@/lib/plan";

// Shared by the server page and the client components (no "use client" here,
// so the server can call these functions).
export type ClientBusiness = {
  id: string;
  slug: string;
  name: string;
  category: string;
  city: string | null;
  pitch: string;
  whatsapp: string | null;
  accentColor: string;
  pageViews: number;
  whatsappClicks: number;
  callClicks: number;
  textClicks: number;
  published: boolean;
  site: SiteData;
  marketing: MarketingData;
  plan: BusinessPlan;
};

export function toClientBusiness(b: BusinessRow): ClientBusiness {
  return {
    id: b.id,
    slug: b.slug,
    name: b.name,
    category: b.category,
    city: b.city,
    pitch: b.pitch,
    whatsapp: b.whatsapp,
    accentColor: b.accentColor,
    pageViews: b.pageViews,
    whatsappClicks: b.whatsappClicks,
    callClicks: b.callClicks,
    textClicks: b.textClicks,
    published: Boolean(b.published),
    site: b.site,
    marketing: b.marketing,
    plan: b.plan,
  };
}

export type ClientService = { id: string; name: string; price: string | null; description: string | null };
export type ClientCampaign = {
  id: string;
  title: string;
  goal: string;
  status: string;
  adCopy: string | null;
  budgetNote: string | null;
  audience: string | null;
  platforms: string | null;
  variations: string | null;
  spec?: CampaignSpec | null;
};
export type ClientMsg = { id: string; role: string; content: string };

export type ClientProject = ProjectSummary;

export type DashboardView = "projects" | "plan" | "store" | "marketing" | "payments" | "capital" | "plans";
export const DASHBOARD_VIEWS: DashboardView[] = ["projects", "plan", "store", "marketing", "payments", "capital", "plans"];

