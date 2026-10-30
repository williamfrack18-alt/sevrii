"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { keepProjectAction, logoutAction, switchProjectAction } from "@/app/actions";
import StoreView from "./StoreView";
import AgentView from "./AgentView";
import MarketingView from "./MarketingView";
import ProjectsView from "./ProjectsView";
import PlanView from "./PlanView";
import PlansView from "./PlansView";
import { PLANS_TEXT } from "@/lib/plansI18n";
import { PLANS, type ClientPlan } from "@/lib/plans";
import ComingSoonView from "./ComingSoonView";
import PaymentsView from "./PaymentsView";
import AffiliatesView from "./AffiliatesView";
import LangToggle from "@/components/LangToggle";
import { useT, useLang } from "@/components/LangProvider";
import { PLAN_TEXT } from "@/lib/planI18n";
import type { ClientBusiness, ClientService, ClientCampaign, ClientMsg, ClientProject, DashboardView } from "./types";

export type { ClientBusiness, ClientService, ClientCampaign, ClientMsg, DashboardView } from "./types";
import { DASHBOARD_VIEWS } from "./types";
import ChatsView from "./ChatsView";
import { unreadChatsAction } from "@/app/chatActions";
import { BRAND_BTN } from "@/lib/panel";

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
      <path d="M4 10.5L12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5H15v-6h-6v6H5.5A1.5 1.5 0 0 1 4 19z" />
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
  agent: (
    <>
      <rect x="4.5" y="8" width="15" height="11" rx="3.5" />
      <path d="M12 8V4.5M10.5 4.5h3" />
      <path d="M9.5 13.2h.01M14.5 13.2h.01" />
      <path d="M2.5 12.5v2.5M21.5 12.5v2.5" />
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
  affiliates: (
    <>
      <circle cx="8" cy="8" r="3" />
      <circle cx="17" cy="15" r="3" />
      <path d="M10.4 9.8l4.2 3.4" />
      <path d="M3.5 20a4.5 4.5 0 0 1 8 -2.8" />
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
  agentMessages = [],
  agentGreeting = "",
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
  agentMessages?: ClientMsg[];
  agentGreeting?: string;
  planGreeting: string;
  plan: ClientPlan;
  planNotice?: "success" | "cancel" | "projects" | "publish" | null;
  storeGreeting: string;
  marketingGreeting: string;
}) {
  const t = useT();
  const lang = useLang();
  const es = lang === "es";
  const pt = PLAN_TEXT[lang];
  const bt = PLANS_TEXT[lang];
  const limits = PLANS[plan.id].limits;
  const [view, setViewState] = useState<DashboardView>(initialView);
  // Store opens a small sub-menu with the chats ("Conversaciones").
  const [storeOpen, setStoreOpen] = useState(true);
  // The project switcher at the top of the side menu (opens a list of projects).
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [switching, startSwitch] = useTransition();
  const switcherRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!switcherOpen) return;
    const away = (e: MouseEvent) => switcherRef.current && !switcherRef.current.contains(e.target as Node) && setSwitcherOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setSwitcherOpen(false);
    window.addEventListener("mousedown", away);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [switcherOpen]);
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
  // This tab's project stays the active one whenever the tab is in front
  // (see keepProjectAction): each project keeps its own chats.
  useEffect(() => {
    const keep = () => {
      if (document.visibilityState === "visible") keepProjectAction(business.id).catch(() => {});
    };
    keep();
    window.addEventListener("focus", keep);
    document.addEventListener("visibilitychange", keep);
    return () => {
      window.removeEventListener("focus", keep);
      document.removeEventListener("visibilitychange", keep);
    };
  }, [business.id]);
  const [currentServices, setCurrentServices] = useState<ClientService[]>(services);
  const [currentCampaigns, setCurrentCampaigns] = useState<ClientCampaign[]>(campaigns);
  const [storeMessages, setStoreMessages] = useState<ClientMsg[]>(editorMessages);
  const [agentMsgs, setAgentMsgs] = useState<ClientMsg[]>(agentMessages);
  const [brainMessages, setBrainMessages] = useState<ClientMsg[]>(marketingMessages);
  const [planMsgs, setPlanMsgs] = useState<ClientMsg[]>(planMessages);
  // Side rail: collapsed (icons only) by default; the choice is remembered on this device.
  const [railOpen, setRailOpen] = useState(false);
  // Animate the width only when the owner toggles it: restoring "open" on load
  // (e.g. coming back from Mi cuenta) must not leave labels squeezed in a
  // half-open rail.
  const [railAnim, setRailAnim] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem("sevrii_rail") === "open") setRailOpen(true);
    } catch {}
  }, []);
  function toggleRail() {
    setRailAnim(true);
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
  // An AI-agent project has its own area right below Store: the agent itself.
  const isAgent = currentBusiness.plan.mode === "agent" || Boolean(currentBusiness.serviceAgent.name);
  const agentLabel = lang === "es" ? "Agente" : "Agent";
  const homeLabel = lang === "es" ? "Inicio" : "Home";
  const items: { id: DashboardView; label: string; soon?: boolean }[] = [
    { id: "projects", label: homeLabel },
    { id: "plan", label: pt.nav.plan },
    { id: "store", label: t.dashboard.store },
    ...(isAgent ? [{ id: "agent" as DashboardView, label: agentLabel }] : []),
    { id: "marketing", label: t.dashboard.marketing },
    { id: "payments", label: "Payments" },
    { id: "affiliates", label: lang === "es" ? "Afiliados" : "Affiliates" },
    { id: "capital", label: "Capital", soon: true },
  ];

  function NavIcon({ id }: { id: DashboardView }) {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
          coverUrl: currentBusiness.site.coverUrl || p.coverUrl,
        }
      : p
  );

  // Mobile: the 5 places used every day in the bottom bar; the rest (Payments,
  // Affiliates, plan, account) in the sheet the avatar opens at the top right.
  const tabs: { id: DashboardView; label: string }[] = [
    { id: "projects", label: homeLabel },
    { id: "plan", label: pt.nav.plan },
    { id: "store", label: t.dashboard.store },
    { id: "chats", label: "Chats" },
    { id: "marketing", label: t.dashboard.marketing },
  ];
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMoreOpen(false);
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [moreOpen]);
  function go(next: DashboardView) {
    setMoreOpen(false);
    setView(next);
  }

  function TabIcon({ d, size = 24 }: { d: React.ReactNode; size?: number }) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {d}
      </svg>
    );
  }
  const ACCOUNT_ICON = (
    <>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </>
  );
  const LOGOUT_ICON = (
    <>
      <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
      <path d="M10 16l-4-4 4-4M6 12h10" />
    </>
  );
  const CHEVRON = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-pfaint shrink-0" aria-hidden="true">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
  const sheetRows: { id: DashboardView; label: string; meta?: React.ReactNode }[] = [
    ...(isAgent ? [{ id: "agent" as DashboardView, label: agentLabel }] : []),
    { id: "payments", label: "Payments" },
    { id: "affiliates", label: lang === "es" ? "Afiliados" : "Affiliates" },
    { id: "capital", label: "Capital", meta: <span className="dash-soon">{t.dashboard.soon}</span> },
    {
      id: "plans",
      label: bt.nav,
      meta:
        plan.id === "free" ? (
          <span className="text-[12px] font-medium px-3 py-1 rounded-full" style={BRAND_BTN}>
            {bt.lock.upgrade}
          </span>
        ) : (
          <span className="text-[13px] text-pmuted">{bt.plans[plan.id].name}</span>
        ),
    },
  ];
  const avatar = (
    <span className="w-9 h-9 rounded-full bg-pcard text-pfg flex items-center justify-center text-[12px] font-medium shrink-0" style={{ boxShadow: "0 1px 2px rgba(10,10,10,.06), 0 0 0 1px rgba(10,10,10,.06)" }}>
      {initials(userEmail)}
    </span>
  );

  return (
    // --hdr (set in globals.css on .dash-root) = height of the mobile chrome:
    // top bar + bottom tab bar + safe areas; 0 on desktop.
    // Full-height views use calc(100dvh - var(--hdr)).
    <div className="dash-root theme-panel flex flex-col md:flex-row">
      {/* Mobile top bar: current project (opens Inicio), avatar (opens the menu) */}
      <header className="dash-topbar md:hidden sticky top-0 z-30">
        <button
          type="button"
          onClick={() => setView("projects")}
          aria-label={`${homeLabel}: ${currentBusiness.name}`}
          className="min-w-0 flex-1 h-11 flex items-center gap-2.5 pr-2 rounded-full active:bg-black/[0.04] transition-colors"
        >
          <span
            className="w-8 h-8 rounded-full text-white flex items-center justify-center text-[11px] font-medium shrink-0"
            style={{ background: "linear-gradient(135deg, #16A34A 0%, #052E16 100%)" }}
          >
            {initials(currentBusiness.name)}
          </span>
          <span className="min-w-0 truncate text-[16px] font-medium text-pfg">{currentBusiness.name}</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-pfaint shrink-0" aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
        <button type="button" onClick={() => setMoreOpen(true)} aria-label={lang === "es" ? "Menú" : "Menu"} aria-expanded={moreOpen} className="shrink-0 h-11 w-11 flex items-center justify-center rounded-full">
          {avatar}
        </button>
      </header>

      {/* Mobile bottom tab bar */}
      <nav className="dash-tabbar md:hidden" aria-label="Sevrii">
        {tabs.map((tb) => {
          const on = view === tb.id;
          return (
            <button key={tb.id} type="button" onClick={() => go(tb.id)} aria-current={on ? "page" : undefined} className={`dash-tab ${on ? "on" : ""}`}>
              <span className="relative">
                <TabIcon d={ICONS[tb.id]} />
                {tb.id === "chats" && unreadChats > 0 && <span className="dash-tab-badge">{unreadChats > 99 ? "99+" : unreadChats}</span>}
              </span>
              <span className="dash-tab-label">{tb.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Mobile menu sheet (from the avatar) */}
      {moreOpen && (
        <div className="md:hidden fixed inset-0 z-[45]" role="dialog" aria-modal="true" aria-label={lang === "es" ? "Menú" : "Menu"}>
          <button type="button" aria-label={lang === "es" ? "Cerrar" : "Close"} className="dash-sheet-backdrop" onClick={() => setMoreOpen(false)} />
          <div className="dash-sheet">
            <div className="mx-auto mt-2.5 mb-2 h-1 w-10 rounded-full bg-black/10" />
            <div className="px-5 pt-2 pb-3 flex items-center gap-3">
              {avatar}
              <span className="min-w-0 flex flex-col">
                <span className="text-[16px] font-medium text-pfg">{lang === "es" ? "Tu cuenta" : "Your account"}</span>
                <span className="text-[13px] text-pmuted truncate">{userEmail}</span>
              </span>
              <span className="grow" />
              <LangToggle className="tap shrink-0" />
            </div>
            <div className="flex flex-col">
              {sheetRows.map((r) => (
                <button key={r.id} type="button" onClick={() => go(r.id)} className={`dash-sheet-row ${view === r.id ? "on" : ""}`}>
                  <TabIcon d={ICONS[r.id]} size={22} />
                  <span className="grow min-w-0 truncate text-left">{r.label}</span>
                  {r.meta}
                  {CHEVRON}
                </button>
              ))}
            </div>
            <div className="h-px my-2 mx-5 bg-black/[0.06]" />
            <div className="flex flex-col">
              <a href="/account" className="dash-sheet-row">
                <TabIcon d={ACCOUNT_ICON} size={22} />
                <span className="grow text-left">{lang === "es" ? "Mi cuenta" : "My account"}</span>
                {CHEVRON}
              </a>
              <form action={logoutAction}>
                <button type="submit" className="dash-sheet-row w-full !text-red-600">
                  <TabIcon d={LOGOUT_ICON} size={22} />
                  <span className="grow text-left">{t.dashboard.logout}</span>
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Desktop rail: collapsed to icons by default, expands with the toggle */}
      <aside
        className={`hidden md:flex ${railOpen ? "w-[256px] min-w-[256px] p-4 overflow-y-auto overflow-x-hidden" : "w-[76px] min-w-[76px] px-3 py-4"} shrink-0 sticky top-0 z-30 h-screen flex-col justify-between ${railAnim ? "transition-[width,min-width] duration-200" : ""} bg-pcard`}
        style={{ boxShadow: "1px 0 0 rgba(10,10,10,.06)" }}
      >
        <div className="min-w-0">
          <div className={`flex items-center ${railOpen ? "justify-between pl-2" : "flex-col gap-4"} mb-6 pt-1`}>
            <a href="/dashboard" aria-label="Sevrii" className="flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/assets/sevrii-logo.png" alt="" className="h-7 w-7 object-contain invert" />
              {railOpen && <span className="text-[19px] font-medium tracking-[-0.02em] text-pfg">Sevrii</span>}
            </a>
            <button
              type="button"
              onClick={toggleRail}
              aria-label={railOpen ? t.dashboard.collapse : t.dashboard.expand}
              title={railOpen ? t.dashboard.collapse : t.dashboard.expand}
              className="h-9 w-9 rounded-full flex items-center justify-center text-pmuted hover:text-pfg hover:bg-black/[0.05]"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="16" rx="2.5" />
                <path d="M9 4v16" />
                {railOpen ? <path d="M15.5 10l-2 2 2 2" /> : <path d="M13.5 10l2 2-2 2" />}
              </svg>
            </button>
          </div>

          {railOpen && (
            <div ref={switcherRef} className="relative mb-5">
            <button
              type="button"
              onClick={() => setSwitcherOpen((o) => !o)}
              aria-haspopup="menu"
              aria-expanded={switcherOpen}
              title={es ? "Cambiar de proyecto" : "Switch project"}
              className="w-full text-left flex items-center gap-2.5 p-2.5 rounded-[20px] bg-pbg hover:bg-psoft transition"
            >
              <div className="w-9 h-9 rounded-full text-white flex items-center justify-center text-[11.5px] font-medium shrink-0" style={{ background: "linear-gradient(135deg, #16A34A 0%, #052E16 100%)" }}>
                {initials(currentBusiness.name)}
              </div>
              <div className="grow min-w-0">
                <div className="text-[13.5px] font-medium text-pfg truncate">{currentBusiness.name}</div>
                <div className="text-[11.5px] text-pmuted truncate">
                  {projects.length > 1 ? `${pt.nav.projects} · ${projects.length}` : `sevrii.com/site/${currentBusiness.slug}`}
                </div>
              </div>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-pfaint shrink-0">
                <path d="M8 9l4-4 4 4M16 15l-4 4-4-4" />
              </svg>
            </button>
            {switcherOpen && (
              <div role="menu" className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 rounded-[18px] bg-white p-1.5 flex flex-col max-h-[60vh] overflow-y-auto" style={{ boxShadow: "0 12px 40px -12px rgba(10,10,10,.35), 0 0 0 1px rgba(10,10,10,.08)" }}>
                <span className="px-3 pt-2 pb-1.5 text-[11.5px] text-pmuted">{es ? "Tus proyectos" : "Your projects"}</span>
                {projects.map((p) => {
                  const here = p.id === currentBusiness.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      role="menuitem"
                      disabled={switching}
                      onClick={() => {
                        setSwitcherOpen(false);
                        if (here) setView("plan");
                        else startSwitch(() => switchProjectAction(p.id));
                      }}
                      className="w-full text-left flex items-center gap-2.5 px-2.5 py-2 rounded-xl hover:bg-psoft transition disabled:opacity-60"
                    >
                      <span className="w-7 h-7 rounded-full text-white flex items-center justify-center text-[10.5px] font-medium shrink-0" style={{ background: "linear-gradient(135deg, #16A34A 0%, #052E16 100%)" }}>
                        {initials(p.name)}
                      </span>
                      <span className="grow min-w-0 flex flex-col">
                        <span className="text-[13.5px] font-medium text-pfg truncate">{p.name}</span>
                        <span className="text-[11.5px] text-pmuted truncate">{p.published ? (es ? "Publicada" : "Published") : es ? "Borrador" : "Draft"}</span>
                      </span>
                      {here && <span className="text-[11px] font-semibold shrink-0" style={{ color: "#16A34A" }}>{es ? "Abierto" : "Open"}</span>}
                    </button>
                  );
                })}
                <div className="h-px bg-black/[0.06] my-1 mx-2" />
                <button type="button" role="menuitem" onClick={() => { setSwitcherOpen(false); setView("projects"); }} className="w-full text-left px-3 py-2 rounded-xl text-[13px] text-pfg hover:bg-psoft">
                  {es ? "Ver todos mis proyectos" : "See all my projects"}
                </button>
                <a role="menuitem" href="/start?new=1" className="w-full text-left px-3 py-2 rounded-xl text-[13px] font-semibold hover:bg-psoft" style={{ color: "#16A34A" }}>
                  + {es ? "Nuevo proyecto" : "New project"}
                </a>
              </div>
            )}
            </div>
          )}

          <nav className="flex flex-col gap-1">
            {items.map((it, i) => (
              <div key={it.id}>
                {railOpen && i === 1 && <div className="text-[11.5px] text-pfaint mt-5 mb-2 px-3">{t.dashboard.pillarsLabel}</div>}
                {!railOpen && i === 1 && <div className="h-px bg-black/[0.06] my-2 mx-2" />}
                <button
                  type="button"
                  onClick={() => (it.id === "store" && view === "store" && railOpen ? setStoreOpen((o) => !o) : setView(it.id))}
                  title={railOpen ? undefined : it.label}
                  aria-label={it.label}
                  aria-current={view === it.id ? "page" : undefined}
                  aria-expanded={it.id === "store" ? storeOpen : undefined}
                  className={`dash-nav w-full ${railOpen ? "" : "!justify-center !px-0 relative h-11"} ${view === it.id ? "on" : ""}`}
                >
                  <NavIcon id={it.id} />
                  {!railOpen && <span className="rail-tip">{it.label}</span>}
                  {railOpen && <span className="grow text-left whitespace-nowrap truncate">{it.label}</span>}
                  {railOpen && it.id === "store" && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-50 transition-transform" style={{ transform: storeOpen ? "rotate(180deg)" : "none" }}>
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  )}
                  {railOpen && it.soon && <span className="dash-soon">{t.dashboard.soon}</span>}
                  {!railOpen && it.soon && <span className="absolute top-2 right-3 h-1.5 w-1.5 rounded-full bg-pfaint" />}
                </button>
                {it.id === "store" && (storeOpen || !railOpen) && (
                  <button
                    type="button"
                    onClick={() => setView("chats")}
                    title={railOpen ? undefined : chatsLabel}
                    aria-label={chatsLabel}
                    aria-current={view === "chats" ? "page" : undefined}
                    className={`dash-nav w-full mt-1 ${railOpen ? "dash-sub" : "!justify-center !px-0 relative h-11"} ${view === "chats" ? "on" : ""}`}
                  >
                    <NavIcon id="chats" />
                    {!railOpen && <span className="rail-tip">{chatsLabel}</span>}
                    {railOpen && <span className="grow text-left whitespace-nowrap truncate">{chatsLabel}</span>}
                    {railOpen && unreadChats > 0 && <span className="dash-badge">{unreadChats}</span>}
                    {!railOpen && unreadChats > 0 && <span className="absolute top-2 right-3 h-2 w-2 rounded-full bg-pgreen" />}
                  </button>
                )}
              </div>
            ))}
          </nav>
        </div>

        <div className={`flex flex-col gap-2.5 pt-4 ${railOpen ? "" : "items-center"}`}>
          {railOpen ? (
            <button
              type="button"
              onClick={() => setView("plans")}
              className={`w-full flex items-center justify-between gap-2 rounded-[20px] px-3.5 py-3 text-left transition ${view === "plans" ? "bg-psoft" : "bg-pbg hover:bg-psoft"}`}
            >
              <span className="flex flex-col min-w-0">
                <span className="text-[11.5px] text-pmuted">{bt.lock.plan}</span>
                <span className="text-[14px] font-medium text-pfg truncate">{bt.plans[plan.id].name}</span>
              </span>
              {plan.id === "free" ? (
                <span className="text-[12px] font-medium px-3 py-1.5 rounded-full shrink-0" style={BRAND_BTN}>
                  {bt.lock.upgrade}
                </span>
              ) : (
                <span className="text-[12px] text-pmuted shrink-0">{bt.nav} →</span>
              )}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setView("plans")}
              title={`${bt.lock.plan}: ${bt.plans[plan.id].name}`}
              aria-label={lang === "es" ? `Tu plan: ${bt.plans[plan.id].name} · ver Planes` : `Your plan: ${bt.plans[plan.id].name} · see Plans`}
              className={`dash-nav w-full !justify-center !px-0 relative h-11 ${view === "plans" ? "on" : ""}`}
            >
              <NavIcon id="plans" />
              {/* The star is "Planes": say so on hover, like the open menu's plan card. */}
              <span className="rail-tip">{lang === "es" ? `Tu plan: ${bt.plans[plan.id].name} · ver Planes` : `Your plan: ${bt.plans[plan.id].name} · see Plans`}</span>
              {plan.id === "free" && <span className="absolute top-2 right-3 h-1.5 w-1.5 rounded-full bg-pgreen" />}
            </button>
          )}
          {railOpen ? (
            <>
              <div className="flex items-center justify-between gap-2 px-1">
                <div className="flex items-center gap-2.5 min-w-0">
                  {avatar}
                  <div className="text-[12.5px] text-pfg2 truncate min-w-0">{userEmail}</div>
                </div>
                <LangToggle />
              </div>
              <div className="flex items-center gap-4 px-1">
                <a href="/account" className="text-[12.5px] text-pmuted hover:text-pfg whitespace-nowrap">
                  {lang === "es" ? "Mi cuenta" : "My account"}
                </a>
                <form action={logoutAction}>
                  <button type="submit" className="text-[12.5px] text-pmuted hover:text-pfg whitespace-nowrap">
                    {t.dashboard.logout}
                  </button>
                </form>
              </div>
            </>
          ) : (
            <button type="button" onClick={toggleRail} title={userEmail} aria-label={lang === "es" ? "Tu cuenta: abrir el menú" : "Your account: open the menu"} className="rail-host relative rounded-full">
              {avatar}
              <span className="rail-tip">{lang === "es" ? `Tu cuenta (${userEmail})` : `Your account (${userEmail})`}</span>
            </button>
          )}
        </div>
      </aside>

      {/* Main content */}
      <main className="dash-main grow min-w-0">
        {view === "projects" && (
          <ProjectsView
            projects={liveProjects}
            activeId={currentBusiness.id}
            onNavigate={setView}
            projectLimit={limits.projects}
            business={currentBusiness}
            unreadChats={unreadChats}
            userEmail={userEmail}
          />
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
            onPayments={() => setView("payments")}
            onBrain={() => setView("plan")}
            onAgent={() => setView("agent")}
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
        {view === "agent" && (
          <AgentView
            business={currentBusiness}
            services={currentServices}
            initialMessages={agentMsgs}
            greeting={agentGreeting}
            onMessages={setAgentMsgs}
            onPayments={() => setView("payments")}
            onStore={() => setView("store")}
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
        {view === "affiliates" && <AffiliatesView business={currentBusiness} onNavigate={setView} />}
        {view === "capital" && <ComingSoonView pillar="capital" onBack={() => setView("projects")} onPlans={() => setView("plans")} payReady={currentBusiness.payReady} onPayments={() => setView("payments")} />}
      </main>
    </div>
  );
}
