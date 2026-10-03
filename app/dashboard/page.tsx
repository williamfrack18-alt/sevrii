import { redirect } from "next/navigation";
import { getLang } from "@/lib/lang";
import { storeGreeting } from "@/lib/storeAgent";
import { marketingGreeting } from "@/lib/marketingBrain";
import { planGreeting } from "@/lib/planBrain";
import { getCurrentUser } from "@/lib/session";
import { listServices, listCampaigns, listChatMessages, listProjects } from "@/lib/db";
import DashboardTabs from "./DashboardTabs";
import { DASHBOARD_VIEWS, toClientBusiness, type DashboardView } from "./types";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.business) redirect("/start");

  const raw = (await searchParams)?.view;
  // Old links used "home"; Projects replaced it.
  const requested = (raw === "home" ? "projects" : raw) as DashboardView | undefined;
  const initialView: DashboardView = requested && DASHBOARD_VIEWS.includes(requested) ? requested : "projects";

  const business = user.business;
  const services = await listServices(business.id);
  const campaigns = await listCampaigns(business.id);
  const projects = await listProjects(user.id);
  const planMessages = await listChatMessages(business.id, "plan");
  const marketingMessages = await listChatMessages(business.id, "brain");
  const editorMessages = await listChatMessages(business.id, "store");
  const lang = await getLang();
  const storeGreetingText = storeGreeting(lang, business, services.length);

  return (
    <DashboardTabs
      key={business.id}
      initialView={initialView}
      userEmail={user.email}
      business={toClientBusiness(business)}
      projects={projects}
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
      planMessages={planMessages.map((m) => ({ id: m.id, role: m.role, content: m.content }))}
      planGreeting={planGreeting(lang, business)}
      marketingMessages={marketingMessages.map((m) => ({ id: m.id, role: m.role, content: m.content }))}
      editorMessages={editorMessages.map((m) => ({ id: m.id, role: m.role, content: m.content }))}
      storeGreeting={storeGreetingText}
      marketingGreeting={marketingGreeting(lang, business)}
    />
  );
}
