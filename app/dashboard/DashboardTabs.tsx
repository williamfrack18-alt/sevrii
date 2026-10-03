"use client";

import { useState } from "react";
import { logoutAction } from "@/app/actions";
import StoreView from "./StoreView";
import MarketingView from "./MarketingView";
import HomeView from "./HomeView";
import ComingSoonView from "./ComingSoonView";
import BrandMark from "@/components/BrandMark";
import LangToggle from "@/components/LangToggle";
import { useT } from "@/components/LangProvider";

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
};

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
};
export type ClientMsg = { id: string; role: string; content: string };

export type DashboardView = "home" | "store" | "marketing" | "payments" | "capital";
export const DASHBOARD_VIEWS: DashboardView[] = ["home", "store", "marketing", "payments", "capital"];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

const ICONS: Record<DashboardView, React.JSX.Element> = {
  home: (
    <>
      <path d="M3 10.5L12 3l9 7.5" />
      <path d="M5 9.5V20h14V9.5" />
    </>
  ),
  store: (
    <>
      <path d="M4 9l1-5h14l1 5" />
      <path d="M4 9a2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0" />
      <path d="M5 9v11h14V9" />
    </>
  ),
  marketing: (
    <>
      <path d="M3 17l6-6 4 4 8-8" />
      <path d="M15 7h6v6" />
    </>
  ),
  payments: (
    <>
      <rect x="2.5" y="6" width="19" height="13" rx="2" />
      <path d="M2.5 10h19" />
      <path d="M6 15h4" />
    </>
  ),
  capital: (
    <>
      <path d="M12 21V10" />
      <path d="M12 10c0-3.5-2.5-6-7-6 0 4.5 2.5 7 7 7" />
      <path d="M12 14c0-3.5 2.5-6 7-6 0 4.5-2.5 7-7 7" />
    </>
  ),
};

export default function DashboardTabs({
  initialView = "home",
  userEmail,
  business,
  services,
  campaigns,
  marketingMessages,
  editorMessages,
}: {
  initialView?: DashboardView;
  userEmail: string;
  business: ClientBusiness;
  services: ClientService[];
  campaigns: ClientCampaign[];
  marketingMessages: ClientMsg[];
  editorMessages: ClientMsg[];
}) {
  const t = useT();
  const [view, setViewState] = useState<DashboardView>(initialView);
  const [currentBusiness, setCurrentBusiness] = useState<ClientBusiness>(business);
  const [currentServices, setCurrentServices] = useState<ClientService[]>(services);
  const [currentCampaigns, setCurrentCampaigns] = useState<ClientCampaign[]>(campaigns);

  function setView(next: DashboardView) {
    setViewState(next);
    // Keep the URL in sync so a refresh or a shared link opens the same section.
    window.history.replaceState(null, "", next === "home" ? "/dashboard" : `/dashboard?view=${next}`);
    window.scrollTo({ top: 0 });
  }

  const items: { id: DashboardView; label: string; n?: string; soon?: boolean }[] = [
    { id: "home", label: t.dashboard.home },
    { id: "store", label: t.dashboard.store, n: "01" },
    { id: "marketing", label: t.dashboard.marketing, n: "02" },
    { id: "payments", label: "Payments", n: "03", soon: true },
    { id: "capital", label: "Capital", n: "04", soon: true },
  ];

  function NavIcon({ id, on }: { id: DashboardView; on: boolean }) {
    return (
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke={on ? "#3ddc84" : "currentColor"}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {ICONS[id]}
      </svg>
    );
  }

  return (
    <div className="theme-dark bg-cream flex flex-col md:flex-row">
      {/* Mobile top bar + section pills */}
      <div className="md:hidden sticky top-0 z-30 bg-cream border-b border-border">
        <div className="h-[64px] px-4 flex items-center justify-between">
          <BrandMark />
          <LangToggle />
        </div>
        <div className="dash-pills flex gap-2 px-4 pb-3 overflow-x-auto">
          {items.map((it) => (
            <button
              key={it.id}
              type="button"
              onClick={() => setView(it.id)}
              className={`dash-pill ${view === it.id ? "on" : ""}`}
            >
              {it.label}
            </button>
          ))}
        </div>
      </div>

      {/* Desktop rail */}
      <aside className="hidden md:flex w-[248px] shrink-0 min-h-screen sticky top-0 h-screen bg-white border-r border-border p-5 flex-col justify-between">
        <div>
          <div className="flex items-center justify-between mb-6">
            <BrandMark />
            <LangToggle />
          </div>
          <a
            href={`/site/${currentBusiness.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2.5 p-2.5 border border-border rounded-[12px] mb-6 hover:border-borderStrong transition"
          >
            <div
              className="w-[30px] h-[30px] rounded-[8px] text-white flex items-center justify-center text-[11px] font-semibold shrink-0"
              style={{ background: `linear-gradient(135deg, ${currentBusiness.accentColor} 0%, #2B4F3A 100%)` }}
            >
              {initials(currentBusiness.name)}
            </div>
            <div className="grow min-w-0">
              <div className="text-[13px] font-semibold text-ink truncate">{currentBusiness.name}</div>
              <div className="text-[11px] text-mutedLight truncate">sevrii.com/site/{currentBusiness.slug}</div>
            </div>
          </a>

          <nav className="flex flex-col gap-1">
            {items.slice(0, 1).map((it) => (
              <button
                key={it.id}
                type="button"
                onClick={() => setView(it.id)}
                className={`dash-nav ${view === it.id ? "on" : ""}`}
              >
                <NavIcon id={it.id} on={view === it.id} />
                <span>{it.label}</span>
              </button>
            ))}
            <div className="text-[11px] font-semibold uppercase tracking-wide text-mutedLight mt-5 mb-2 px-2.5">
              {t.dashboard.pillarsLabel}
            </div>
            {items.slice(1).map((it) => (
              <button
                key={it.id}
                type="button"
                onClick={() => setView(it.id)}
                className={`dash-nav ${view === it.id ? "on" : ""}`}
              >
                <NavIcon id={it.id} on={view === it.id} />
                <span className="grow text-left">{it.label}</span>
                {it.soon ? <span className="dash-soon">{t.dashboard.soon}</span> : <span className="dash-n">{it.n}</span>}
              </button>
            ))}
          </nav>
        </div>

        <div className="flex flex-col gap-2.5 border-t border-border pt-4">
          <div className="flex items-center gap-2.5">
            <div className="w-[28px] h-[28px] rounded-full bg-border text-muted flex items-center justify-center text-[10px] font-semibold shrink-0">
              {initials(userEmail)}
            </div>
            <div className="grow text-[12px] text-ink truncate min-w-0">{userEmail}</div>
          </div>
          <form action={logoutAction}>
            <button type="submit" className="text-[12px] font-medium text-muted hover:text-ink">
              {t.dashboard.logout}
            </button>
          </form>
        </div>
      </aside>

      {/* Main content */}
      <main className="grow min-w-0">
        {view === "home" && (
          <HomeView
            business={currentBusiness}
            services={currentServices}
            campaigns={currentCampaigns}
            onNavigate={setView}
          />
        )}
        {view === "store" && (
          <StoreView
            business={currentBusiness}
            services={currentServices}
            initialMessages={editorMessages}
            onUpdated={(b, s) => {
              setCurrentBusiness(b);
              setCurrentServices(s);
            }}
          />
        )}
        {view === "marketing" && (
          <MarketingView
            business={currentBusiness}
            campaigns={currentCampaigns}
            initialMessages={marketingMessages}
            onCampaignsUpdated={setCurrentCampaigns}
          />
        )}
        {(view === "payments" || view === "capital") && (
          <ComingSoonView pillar={view} onBack={() => setView("home")} />
        )}

        {/* Log out on mobile (the rail with it is hidden there) */}
        <div className="md:hidden px-5 py-6 border-t border-border flex items-center justify-between gap-3">
          <span className="text-[12px] text-muted truncate">{userEmail}</span>
          <form action={logoutAction}>
            <button type="submit" className="text-[12px] font-medium text-muted hover:text-ink">
              {t.dashboard.logout}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
