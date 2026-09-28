import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { listServices, listCampaigns, listChatMessages } from "@/lib/db";
import { logoutAction } from "@/app/actions";
import DashboardTabs from "./DashboardTabs";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.business) redirect("/start");

  const business = user.business;
  const services = await listServices(business.id);
  const campaigns = await listCampaigns(business.id);
  const marketingMessages = await listChatMessages(business.id, "marketing");

  return (
    <div className="min-h-screen bg-cream">
      <header className="border-b border-border bg-white">
        <div className="max-w-[1100px] mx-auto px-8 h-[72px] flex items-center justify-between">
          <Link href="/" className="font-serif text-xl font-semibold text-ink">
            Sevri
          </Link>
          <div className="flex items-center gap-4">
            <span className="text-[13.5px] text-muted">{user.email}</span>
            <form action={logoutAction}>
              <button type="submit" className="text-[13.5px] font-medium text-muted hover:text-ink">
                Log out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="max-w-[1100px] mx-auto px-8 py-10">
        <DashboardTabs
          business={{
            id: business.id,
            slug: business.slug,
            name: business.name,
            category: business.category,
            city: business.city,
            pitch: business.pitch,
            whatsapp: business.whatsapp,
            accentColor: business.accentColor,
          }}
          services={services.map((s) => ({ id: s.id, name: s.name, price: s.price, description: s.description }))}
          campaigns={campaigns.map((c) => ({
            id: c.id,
            title: c.title,
            goal: c.goal,
            status: c.status,
            adCopy: c.adCopy,
            budgetNote: c.budgetNote,
          }))}
          marketingMessages={marketingMessages.map((m) => ({ id: m.id, role: m.role, content: m.content }))}
        />
      </main>
    </div>
  );
}
