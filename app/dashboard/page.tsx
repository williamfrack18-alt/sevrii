import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getLang } from "@/lib/lang";
import { agentAreaGreeting, storeGreeting } from "@/lib/storeAgent";
import { marketingGreeting } from "@/lib/marketingBrain";
import { planGreeting } from "@/lib/planBrain";
import { getCurrentUser } from "@/lib/session";
import { listServices, listCampaigns, listChatMessages, listProjects, setUserLang } from "@/lib/db";
import { clientPlan, syncCheckoutSession } from "@/lib/billing";
import DashboardTabs from "./DashboardTabs";
import { DASHBOARD_VIEWS, toClientBusiness, type DashboardView } from "./types";

// Marketing's cloud browser makes videos in steps of up to a few minutes (server actions of this page).
export const maxDuration = 300;

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; checkout?: string; need?: string; session_id?: string }>;
}) {
  let user = await getCurrentUser();
  if (!user) redirect("/login");
  // Someone who only wants to be an affiliate (no project) lands on that panel.
  if (!user.business) redirect((await cookies()).get("sevrii_path")?.value === "affiliate" ? "/panel-afiliado" : "/start");

  const sp = (await searchParams) ?? {};
  // Back from paying: turn the plan on now (the webhook may arrive a bit later).
  if (sp.checkout === "success" && sp.session_id) {
    await syncCheckoutSession(user, sp.session_id);
    user = (await getCurrentUser()) ?? user;
  }
  const raw = sp.view;
  const planNotice =
    sp.checkout === "success" ? "success" : sp.checkout === "cancel" ? "cancel" : sp.need === "projects" ? "projects" : sp.need === "publish" ? "publish" : null;
  // Old links used "home"; Projects replaced it.
  const requested = (raw === "home" ? "projects" : raw) as DashboardView | undefined;
  const initialView: DashboardView = requested && DASHBOARD_VIEWS.includes(requested) ? requested : "projects";

  const business = user.business!;
  const services = await listServices(business.id);
  const campaigns = await listCampaigns(business.id);
  const projects = await listProjects(user.id);
  const planMessages = await listChatMessages(business.id, "plan");
  const marketingMessages = await listChatMessages(business.id, "brain");
  const editorMessages = await listChatMessages(business.id, "store");
  const agentMessages = await listChatMessages(business.id, "agent");
  const lang = await getLang();
  // Owners from before languages were saved: keep the one they're reading in.
  if (user.lang !== "es" && user.lang !== "en") await setUserLang(user.id, lang).catch(() => {});
  const plan = await clientPlan(user);
  const storeGreetingText = storeGreeting(lang, business, services.length);

  return (
    <DashboardTabs
      key={business.id}
      initialView={initialView}
      userEmail={user.email}
      business={toClientBusiness(business)}
      projects={projects}
      plan={plan}
      planNotice={planNotice}
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
      agentMessages={agentMessages.map((m) => ({ id: m.id, role: m.role, content: m.content }))}
      agentGreeting={agentAreaGreeting(lang, business)}
      marketingGreeting={marketingGreeting(lang, business)}
    />
  );
}
