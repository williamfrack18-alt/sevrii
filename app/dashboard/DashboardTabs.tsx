"use client";

import { useEffect, useState } from "react";
import { logoutAction } from "@/app/actions";
import StoreView from "./StoreView";
import MarketingView from "./MarketingView";
import ProjectsView from "./ProjectsView";
import PlanView from "./PlanView";
import PlansView from "./PlansView";
import { PLANS_TEXT } from "@/lib/plansI18n";
import { PLANS, type ClientPlan } from "@/lib/plans";
import ComingSoonView from "./ComingSoonView";
import PaymentsView from "./PaymentsView";
import BrandMark from "@/components/BrandMark";
import LangToggle from "@/components/LangToggle";
import { useT, useLang } from "@/components/LangProvider";
import { PLAN_TEXT } from "@/lib/planI18n";
import type { ClientBusiness, ClientService, ClientCampaign, ClientMsg, ClientProject, DashboardView } from "./types";

export type { ClientBusiness, ClientService, ClientCampaign, ClientMsg, DashboardView } from "./types";
import { DASHBOARD_VIEWS } from "./types";
import ChatsView from "./ChatsView";
import { unreadChatsAction } from "@/app/chatActions";
import { ACCENT, BRAND_BTN } from "@/lib/brand";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

const ICONS: Record<DashboardView, React.JSX.Element> = {
  plans: (
    <>
      <path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z" />
    </>
  ),
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
  chats: (
    <>
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12z" />
      <path d="M8.5 12h.01M12 12h.01M15.5 12h.01" />
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
  plan,
  planNotice = null,
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
  plan: ClientPlan;
  planNotice?: "success" | "cancel" | "projects" | "publish" | null;
  storeGreeting: string;
  marketingGreeting: string;
}) {
  const t = useT();
  const lang = useLang();
  const pt = PLAN_TEXT[lang];
  const bt = PLANS_TEXT[lang];
  const limits = PLANS[plan.id].limits;
  const [view, setViewState] = useState<DashboardView>(initialView);
  // Store opens a small sub-menu with the chats ("Conversaciones").
  const [storeOpen, setStoreOpen] = useState(true);
  const [unreadChats, setUnreadChats] = useState(0);
  useEffect(() => {
    let alive = true;
    const check = () =>
      unreadChatsAction()
        .then((n) => alive && setUnreadChats(n))
        .catch(() => {});
    check();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") check();
    }, 30000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [view, business.id]);
  // A link to /dashboard?view=… while the dashboard is already open keeps this
  // component mounted, so follow the new section from the URL.
  useEffect(() => {
    setViewState(initialView);
  }, [initialView]);
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
    if (next === "store" || next === "chats") setStoreOpen(true);
    // Keep the URL in sync so a refresh or a shared link opens the same section.
    window.history.replaceState(null, "", next === "projects" ? "/dashboard" : `/dashboard?view=${next}`);
    window.scrollTo({ top: 0 });
  }

  const chatsLabel = lang === "es" ? "Conversaciones" : "Conversations";
  const items: { id: DashboardView; label: string; n?: string; soon?: boolean }[] = [
    { id: "projects", label: pt.nav.projects },
    { id: "plan", label: pt.nav.plan, n: "01" },
    { id: "store", label: t.dashboard.store, n: "02" },
    { id: "marketing", label: t.dashboard.marketing, n: "03" },
    { id: "payments", label: "Payments", n: "04" },
    { id: "capital", label: "Capital", n: "05", soon: true },
  ];

  function NavIcon({ id, on }: { id: DashboardView; on: boolean }) {
    return (
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke={on ? ACCENT : "currentColor"}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {ICONS[id]}
      </svg>
    );
  }

  // Projects come from the server once; keep the open one in step with what
  // changed since (name, published, services…) so the cards aren't stale.
  const liveProjects = projects.map((p) =>
    p.id === currentBusiness.id
      ? {
          ...p,
          name: currentBusiness.name,
          slug: currentBusiness.slug,
          category: currentBusiness.category,
          city: currentBusiness.city,
          accentColor: currentBusiness.accentColor,
          published: currentBusiness.published,
          pageViews: currentBusiness.pageViews,
          contacts: currentBusiness.callClicks + currentBusiness.textClicks + currentBusiness.whatsappClicks,
          services: currentServices.length,
          campaigns: currentCampaigns.filter((c) => c.spec).length,
          planService: currentBusiness.plan.service || p.planService,
          planReady: currentBusiness.plan.ready,
        }
      : p
  );

  // Views that fill the screen below the mobile header (their own chat scrolls).
  const fullHeight = view === "plan" || view === "store" || view === "chats" || view === "marketing";

  return (
    // --hdr = height of the mobile top bar below: 64px bar + 34px pills + 12px
    // padding + 1px border. Full-height views use calc(100dvh - var(--hdr)).
    <div className="theme-dark bg-cream flex flex-col md:flex-row" style={{ "--hdr": "111px" } as React.CSSProperties}>
      {/* Mobile top bar + section pills (keep --hdr above in sync) */}
      <div className="md:hidden sticky top-0 z-30 bg-cream border-b border-border">
        <div className="h-[64px] px-4 flex items-center justify-between">
          <BrandMark />
          <LangToggle />
        </div>
        <div className="dash-pills flex gap-2 px-4 pb-3 overflow-x-auto">
          {items.map((it) => (
            <span key={it.id} className="contents">
              <button type="button" onClick={() => setView(it.id)} className={`dash-pill ${view === it.id ? "on" : ""}`}>
                {it.label}
              </button>
              {it.id === "store" && (
                <button type="button" onClick={() => setView("chats")} className={`dash-pill ${view === "chats" ? "on" : ""}`}>
                  {chatsLabel}
                  {unreadChats > 0 && <span className="dash-badge">{unreadChats}</span>}
                </button>
              )}
            </span>
          ))}
          <button type="button" onClick={() => setView("plans")} className={`dash-pill ${view === "plans" ? "on" : ""}`}>
            {bt.nav}
          </button>
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
                  onClick={() => (it.id === "store" && view === "store" && railOpen ? setStoreOpen((o) => !o) : setView(it.id))}
                  title={railOpen ? undefined : it.label}
                  aria-label={it.label}
                  aria-expanded={it.id === "store" ? storeOpen : undefined}
                  className={`dash-nav w-full ${railOpen ? "" : "!justify-center !px-0 relative"} ${view === it.id ? "on" : ""}`}
                >
                  <NavIcon id={it.id} on={view === it.id} />
                  {railOpen && <span className="grow text-left">{it.label}</span>}
                  {railOpen && it.id === "store" && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-mutedLight transition-transform" style={{ transform: storeOpen ? "rotate(180deg)" : "none" }}>
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  )}
                  {railOpen && i > 0 && (it.soon ? <span className="dash-soon">{t.dashboard.soon}</span> : <span className="dash-n">{it.n}</span>)}
                  {!railOpen && it.soon && <span className="absolute top-1.5 right-2 h-1.5 w-1.5 rounded-full bg-[#ffc400]" />}
                </button>
                {it.id === "store" && (storeOpen || !railOpen) && (
                  <button
                    type="button"
                    onClick={() => setView("chats")}
                    title={railOpen ? undefined : chatsLabel}
                    aria-label={chatsLabel}
                    className={`dash-nav w-full mt-1 ${railOpen ? "dash-sub" : "!justify-center !px-0 relative"} ${view === "chats" ? "on" : ""}`}
                  >
                    <NavIcon id="chats" on={view === "chats"} />
                    {railOpen && <span className="grow text-left">{chatsLabel}</span>}
                    {railOpen && unreadChats > 0 && <span className="dash-badge">{unreadChats}</span>}
                    {!railOpen && unreadChats > 0 && <span className="absolute top-1.5 right-2 h-2 w-2 rounded-full" style={{ background: ACCENT }} />}
                  </button>
                )}
              </div>
            ))}
          </nav>
        </div>

        <div className={`flex flex-col gap-2.5 border-t border-border pt-4 ${railOpen ? "" : "items-center"}`}>
          {railOpen ? (
            <button
              type="button"
              onClick={() => setView("plans")}
              className={`w-full flex items-center justify-between gap-2 rounded-[10px] px-2.5 py-2 text-left transition hover:bg-white/5 ${view === "plans" ? "bg-white/5" : ""}`}
            >
              <span className="flex flex-col min-w-0">
                <span className="text-[11px] text-mutedLight">{bt.lock.plan}</span>
                <span className="text-[13px] font-semibold text-ink truncate">{bt.plans[plan.id].name}</span>
              </span>
              {plan.id === "free" ? (
                <span className="text-[11.5px] font-semibold px-2.5 py-1 rounded-full shrink-0" style={BRAND_BTN}>
                  {bt.lock.upgrade}
                </span>
              ) : (
                <span className="text-[11.5px] text-mutedLight shrink-0">{bt.nav} →</span>
              )}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setView("plans")}
              title={`${bt.lock.plan}: ${bt.plans[plan.id].name}`}
              aria-label={bt.nav}
              className={`dash-nav w-full !justify-center !px-0 relative ${view === "plans" ? "on" : ""}`}
            >
              <NavIcon id="plans" on={view === "plans"} />
              {plan.id === "free" && <span className="absolute top-1.5 right-2 h-1.5 w-1.5 rounded-full" style={{ background: ACCENT }} />}
            </button>
          )}
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
              <div className="flex items-center gap-4">
                <a href="/account" className="text-[12px] font-medium text-muted hover:text-ink">
                  {lang === "es" ? "Mi cuenta" : "My account"}
                </a>
                <form action={logoutAction}>
                  <button type="submit" className="text-[12px] font-medium text-muted hover:text-ink">
                    {t.dashboard.logout}
                  </button>
                </form>
              </div>
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
        {view === "projects" && (
          <ProjectsView projects={liveProjects} activeId={currentBusiness.id} onNavigate={setView} projectLimit={limits.projects} />
        )}
        {view === "plans" && <PlansView plan={plan} notice={planNotice} />}
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
        {view === "chats" && (
          <ChatsView businessId={currentBusiness.id} published={currentBusiness.published} onStore={() => setView("store")} />
        )}
        {view === "store" && (
          <StoreView
            onChats={() => setView("chats")}
            business={currentBusiness}
            services={currentServices}
            initialMessages={storeMessages}
            greeting={storeGreeting}
            canPublish={limits.canPublish}
            onPlans={() => setView("plans")}
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
            locked={!limits.marketing}
            onPlans={() => setView("plans")}
            onMessages={setBrainMessages}
            onUpdated={(b, c) => {
              setCurrentBusiness(b);
              setCurrentCampaigns(c);
            }}
          />
        )}
        {view === "payments" && <PaymentsView business={currentBusiness} services={currentServices} />}
        {view === "capital" && <ComingSoonView pillar="capital" onBack={() => setView("projects")} onPlans={() => setView("plans")} />}

        {/* Log out on mobile (the rail with it is hidden there). Not under the
            full-height views, where it would add a second scroll. */}
        {!fullHeight && (
        <div className="md:hidden px-5 py-6 border-t border-border flex items-center justify-between gap-3">
          <a href="/account" className="text-[12px] text-muted truncate">{userEmail}</a>
          <form action={logoutAction}>
            <button type="submit" className="text-[12px] font-medium text-muted hover:text-ink">
              {t.dashboard.logout}
            </button>
          </form>
        </div>
        )}
      </main>
    </div>
  );
}
