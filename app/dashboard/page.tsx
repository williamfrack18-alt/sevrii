import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { listServices, listCampaigns, listChatMessages } from "@/lib/db";
import DashboardTabs, { DASHBOARD_VIEWS, type DashboardView } from "./DashboardTabs";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.business) redirect("/start");

  const requested = (await searchParams)?.view as DashboardView | undefined;
  const initialView: DashboardView = requested && DASHBOARD_VIEWS.includes(requested) ? requested : "home";

  const business = user.business;
  const services = await listServices(business.id);
  const campaigns = await listCampaigns(business.id);
  const marketingMessages = await listChatMessages(business.id, "marketing");
  const editorMessages = await listChatMessages(business.id, "editor");

  return (
    <DashboardTabs
      initialView={initialView}
      userEmail={user.email}
      business={{
        id: business.id,
        slug: business.slug,
        name: business.name,
        category: business.category,
        city: business.city,
        pitch: business.pitch,
        whatsapp: business.whatsapp,
        accentColor: business.accentColor,
        pageViews: business.pageViews,
        whatsappClicks: business.whatsappClicks,
      }}
      services={services.map((s) => ({ id: s.id, name: s.name, price: s.price, description: s.description }))}
      campaigns={campaigns.map((c) => ({
        id: c.id,
        title: c.title,
        goal: c.goal,
        status: c.status,
        adCopy: c.adCopy,
        budgetNote: c.budgetNote,
        audience: c.audience,
        platforms: c.platforms,
        variations: c.variations,
      }))}
      marketingMessages={marketingMessages.map((m) => ({ id: m.id, role: m.role, content: m.content }))}
      editorMessages={editorMessages.map((m) => ({ id: m.id, role: m.role, content: m.content }))}
    />
  );
}
