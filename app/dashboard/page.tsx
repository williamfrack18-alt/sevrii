import { redirect } from "next/navigation";
import { getLang } from "@/lib/lang";
import { storeGreeting } from "@/lib/storeAgent";
import { marketingGreeting } from "@/lib/marketingBrain";
import { getCurrentUser } from "@/lib/session";
import { listServices, listCampaigns, listChatMessages } from "@/lib/db";
import DashboardTabs from "./DashboardTabs";
import { DASHBOARD_VIEWS, toClientBusiness, type DashboardView } from "./types";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.business) redirect("/start");

  const requested = (await searchParams)?.view as DashboardView | undefined;
  const initialView: DashboardView = requested && DASHBOARD_VIEWS.includes(requested) ? requested : "home";

  const business = user.business;
  const services = await listServices(business.id);
  const campaigns = await listCampaigns(business.id);
  const marketingMessages = await listChatMessages(business.id, "brain");
  const editorMessages = await listChatMessages(business.id, "store");
  const lang = await getLang();
  const storeGreetingText = storeGreeting(lang, business, services.length);

  return (
    <DashboardTabs
      initialView={initialView}
      userEmail={user.email}
      business={toClientBusiness(business)}
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
        spec: c.spec ?? null,
      }))}
      marketingMessages={marketingMessages.map((m) => ({ id: m.id, role: m.role, content: m.content }))}
      editorMessages={editorMessages.map((m) => ({ id: m.id, role: m.role, content: m.content }))}
      storeGreeting={storeGreetingText}
      marketingGreeting={marketingGreeting(lang, business)}
    />
  );
}
