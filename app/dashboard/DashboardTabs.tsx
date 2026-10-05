"use client";

import { useEffect, useState } from "react";
import { logoutAction } from "@/app/actions";
import StoreView from "./StoreView";
import MarketingView from "./MarketingView";
import ProjectsView from "./ProjectsView";
import PlanView from "./PlanView";
import ComingSoonView from "./ComingSoonView";
import BrandMark from "@/components/BrandMark";
import LangToggle from "@/components/LangToggle";
import { useT, useLang } from "@/components/LangProvider";
import { PLAN_TEXT } from "@/lib/planI18n";
import type { ClientBusiness, ClientService, ClientCampaign, ClientMsg, ClientProject, DashboardView } from "./types";

export type { ClientBusiness, ClientService, ClientCampaign, ClientMsg, DashboardView } from "./types";
import { DASHBOARD_VIEWS } from "./types";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

const ICONS: Record<DashboardView, React.JSX.Element> = {
  projects: (
    <>
      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2.5h7.5A2.5 2.5 0 0 1 21 10v7.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z" />
    </>
  ),
  plan: (
    <>
      <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
      <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
      <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
      <path d="M12 5v13" />
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
  initialView = "projects",
  userEmail,
  business,
  projects,
  services,
  campaigns,
  planMessages,
  marketingMessages,
  editorMessages,
  planGreeting,
  storeGreeting,
  marketingGreeting,
}: {
  initialView?: DashboardView;
  userEmail: string;
  business: ClientBusiness;
  projects: ClientProject[];
  services: ClientService[];
  campaigns: ClientCampaign[];
  planMessages: ClientMsg[];
  marketingMessages: ClientMsg[];
  editorMessages: ClientMsg[];
  planGreeting: string;
  storeGreeting: string;
  marketingGreeting: string;
}) {
  const t = useT();
  const pt = PLAN_TEXT[useLang()];
  const [view, setViewState] = useState<DashboardView>(initialView);
  const [currentBusiness, setCurrentBusiness] = useState<ClientBusiness>(business);
  const [currentServices, setCurrentServices] = useState<ClientService[]>(services);
  const [currentCampaigns, setCurrentCampaigns] = useState<ClientCampaign[]>(campaigns);
  const [storeMessages, setStoreMessages] = useState<ClientMsg[]>(editorMessages);
  const [brainMessages, setBrainMessages] = useState<ClientMsg[]>(marketingMessages);
  const [planMsgs, setPlanMsgs] = useState<ClientMsg[]>(planMessages);
  // Side rail: collapsed (icons only) by default; the choice is remembered on this device.
  const [railOpen, setRailOpen] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem("sevrii_rail") === "open") setRailOpen(true);
    } catch {}
  }, []);
  function toggleRail() {
    setRailOpen((open) => {
      try {
        localStorage.setItem("sevrii_rail", open ? "closed" : "open");
      } catch {}
      return !open;
    });
  }

  function setView(next: DashboardView) {
    setViewState(next);
    // Keep the URL in sync so a refresh or a shared link opens the same section.
    window.history.replaceState(null, "", next === "projects" ? "/dashboard" : `/dashboard?view=${next}`);
    window.scrollTo({ top: 0 });
  }

  const items: { id: DashboardView; label: string; n?: string; soon?: boolean }[] = [
    { id: "projects", label: pt.nav.projects },
    { id: "plan", label: pt.nav.plan, n: "01" },
    { id: "store", label: t.dashboard.store, n: "02" },
    { id: "marketing", label: t.dashboard.marketing, n: "03" },
    { id: "payments", label: "Payments", n: "04", soon: true },
    { id: "capital", label: "Capital", n: "05", soon: true },
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

      {/* Desktop rail: collapsed to icons by default, expands with the toggle */}
      <aside
        className={`hidden md:flex ${railOpen ? "w-[248px] p-5" : "w-[68px] px-2.5 py-5"} shrink-0 sticky top-0 h-screen border-r border-border flex-col justify-between transition-[width] duration-200`}
        style={{ background: "#0a0a0a" }}
      >
        <div className="min-w-0">
          <div className={`flex items-center ${railOpen ? "justify-between" : "flex-col gap-4"} mb-6`}>
            {railOpen ? (
              <BrandMark />
            ) : (
              <a href="/dashboard" aria-label="Sevrii" className="flex justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/assets/sevrii-logo.png" alt="Sevrii" className="h-7 w-7 object-contain" />
              </a>
            )}
            <button
              type="button"
              onClick={toggleRail}
              aria-label={railOpen ? t.dashboard.collapse : t.dashboard.expand}
              title={railOpen ? t.dashboard.collapse : t.dashboard.expand}
              className="h-8 w-8 rounded-lg flex items-center justify-center text-muted hover:text-ink hover:bg-mint"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="16" rx="2.5" />
                <path d="M9 4v16" />
                {railOpen ? <path d="M15.5 10l-2 2 2 2" /> : <path d="M13.5 10l2 2-2 2" />}
              </svg>
            </button>
          </div>

          {railOpen && (
            <button
              type="button"
              onClick={() => setView("projects")}
              title={pt.nav.projects}
              className="w-full text-left flex items-center gap-2.5 p-2.5 rounded-[12px] mb-5 hover:bg-white/5 transition"
            >
              <div
                className="w-[30px] h-[30px] rounded-[8px] text-white flex items-center justify-center text-[11px] font-semibold shrink-0"
                style={{ background: `linear-gradient(135deg, ${currentBusiness.accentColor} 0%, #2B4F3A 100%)` }}
              >
                {initials(currentBusiness.name)}
              </div>
              <div className="grow min-w-0">
                <div className="text-[13px] font-semibold text-ink truncate">{currentBusiness.name}</div>
                <div className="text-[11px] text-mutedLight truncate">
                  {projects.length > 1 ? `${pt.nav.projects} · ${projects.length}` : `sevrii.com/site/${currentBusiness.slug}`}
                </div>
              </div>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-mutedLight shrink-0">
                <path d="M8 9l4-4 4 4M16 15l-4 4-4-4" />
              </svg>
            </button>
          )}

          <nav className="flex flex-col gap-1">
            {items.map((it, i) => (
              <div key={it.id}>
                {railOpen && i === 1 && (
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-mutedLight mt-5 mb-2 px-2.5">
                    {t.dashboard.pillarsLabel}
                  </div>
                )}
                {!railOpen && i === 1 && <div className="h-px bg-border my-2 mx-2" />}
                <button
                  type="button"
                  onClick={() => setView(it.id)}
                  title={railOpen ? undefined : it.label}
                  aria-label={it.label}
                  className={`dash-nav w-full ${railOpen ? "" : "!justify-center !px-0 relative"} ${view === it.id ? "on" : ""}`}
                >
                  <NavIcon id={it.id} on={view === it.id} />
                  {railOpen && <span className="grow text-left">{it.label}</span>}
                  {railOpen && i > 0 && (it.soon ? <span className="dash-soon">{t.dashboard.soon}</span> : <span className="dash-n">{it.n}</span>)}
                  {!railOpen && it.soon && <span className="absolute top-1.5 right-2 h-1.5 w-1.5 rounded-full bg-[#ffc400]" />}
                </button>
              </div>
            ))}
          </nav>
        </div>

        <div className={`flex flex-col gap-2.5 border-t border-border pt-4 ${railOpen ? "" : "items-center"}`}>
          {railOpen ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-[28px] h-[28px] rounded-full bg-border text-muted flex items-center justify-center text-[10px] font-semibold shrink-0">
                    {initials(userEmail)}
                  </div>
                  <div className="text-[12px] text-ink truncate min-w-0">{userEmail}</div>
                </div>
                <LangToggle />
              </div>
              <form action={logoutAction}>
                <button type="submit" className="text-[12px] font-medium text-muted hover:text-ink">
                  {t.dashboard.logout}
                </button>
              </form>
            </>
          ) : (
            <button
              type="button"
              onClick={toggleRail}
              title={userEmail}
              className="w-[30px] h-[30px] rounded-full bg-border text-muted flex items-center justify-center text-[10px] font-semibold"
            >
              {initials(userEmail)}
            </button>
          )}
        </div>
      </aside>

      {/* Main content */}
      <main className="grow min-w-0">
        {view === "projects" && <ProjectsView projects={projects} activeId={currentBusiness.id} onNavigate={setView} />}
        {view === "plan" && (
          <PlanView
            business={currentBusiness}
            initialMessages={planMsgs}
            greeting={planGreeting}
            onMessages={setPlanMsgs}
            onNavigate={setView}
            onUpdated={(b, s) => {
              setCurrentBusiness(b);
              if (s) setCurrentServices(s);
            }}
          />
        )}
        {view === "store" && (
          <StoreView
            business={currentBusiness}
            services={currentServices}
            initialMessages={storeMessages}
            greeting={storeGreeting}
            onMessages={setStoreMessages}
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
            initialMessages={brainMessages}
            greeting={marketingGreeting}
            onMessages={setBrainMessages}
            onUpdated={(b, c) => {
              setCurrentBusiness(b);
              setCurrentCampaigns(c);
            }}
          />
        )}
        {(view === "payments" || view === "capital") && (
          <ComingSoonView pillar={view} onBack={() => setView("projects")} />
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
