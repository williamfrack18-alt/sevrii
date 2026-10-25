"use client";

import { useState, useTransition } from "react";
import { useLang } from "@/components/LangProvider";
import { PLAN_TEXT, PROJECTS_TEXT } from "@/lib/planI18n";
import { PLANS_TEXT } from "@/lib/plansI18n";
import { deleteProjectAction, switchProjectAction } from "@/app/actions";
import type { ClientBusiness, ClientProject, DashboardView } from "./types";
import { DEEP, GREEN, TINT } from "@/lib/panel";

const MAX_PROJECTS = 10;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

// "carlos.ruiz88@…" → "Carlos"
function firstName(owner: string, email: string): string {
  const fromOwner = owner.trim().split(/\s+/)[0];
  if (fromOwner) return fromOwner;
  const local = email.split("@")[0].replace(/[\d_.+-]+/g, " ").trim().split(/\s+/)[0] || "";
  return local ? local[0].toUpperCase() + local.slice(1).toLowerCase() : "";
}

const TEXT = {
  es: {
    hello: (n: string) => (n ? `Hola, ${n}` : "Hola"),
    sub: (p: string) => `Esto es lo que sigue en ${p}.`,
    continue: "Continuar",
    next: {
      chats: (n: number) => (n === 1 ? "Tienes 1 chat sin leer" : `Tienes ${n} chats sin leer`),
      chatsSub: "Tus clientes te escribieron desde tu página.",
      plan: "Termina tu estrategia",
      planSub: "El Cerebro te hace unas preguntas y arma tu oferta.",
      store: "Publica tu página",
      storeSub: "Revisa tu página y publícala para recibir clientes.",
      marketing: "Arma tu marketing",
      marketingSub: "El chat de Marketing te propone tu estrategia de anuncios.",
      running: "Mira cómo va tu marketing",
      runningSub: "Tu agente revisa tus campañas todos los días.",
    },
    progress: "Tu avance",
    progressSub: (done: number, total: number) => `${done} de ${total} pasos`,
    steps: ["Estrategia lista", "Página publicada", "Marketing aprobado", "Pagos conectados"],
    views: "Visitas",
    contacts: "Contactos",
    unread: "Chats sin leer",
    projects: "Tus proyectos",
    projectsSub: "Cada uno es un servicio que vendes.",
    all: "Todos",
    live: "Publicados",
    draft: "En borrador",
    edit: "Editar",
    done: "Listo",
    open: "Abierto",
    pageLive: "Publicada",
    pageDraft: "Borrador",
    explore: "Explora Sevrii",
    exploreSub: "Todo para vender tu servicio.",
    pillars: {
      plan: ["Cerebro", "Tu oferta y tu estrategia, en una charla."],
      store: ["Store", "Tu página y tu agente que atiende clientes."],
      marketing: ["Marketing", "Tus anuncios en Facebook e Instagram."],
      payments: ["Payments", "Cobra en tu página con tarjeta."],
      affiliates: ["Afiliados", "Otros venden tu servicio por comisión."],
    },
    go: "Abrir",
  },
  en: {
    hello: (n: string) => (n ? `Hi, ${n}` : "Hi"),
    sub: (p: string) => `Here's what's next for ${p}.`,
    continue: "Continue",
    next: {
      chats: (n: number) => (n === 1 ? "You have 1 unread chat" : `You have ${n} unread chats`),
      chatsSub: "Customers wrote to you from your page.",
      plan: "Finish your strategy",
      planSub: "The Brain asks a few questions and builds your offer.",
      store: "Publish your page",
      storeSub: "Review your page and publish it to get customers.",
      marketing: "Build your marketing",
      marketingSub: "The Marketing chat proposes your ad strategy.",
      running: "See how your marketing is doing",
      runningSub: "Your agent checks your campaigns every day.",
    },
    progress: "Your progress",
    progressSub: (done: number, total: number) => `${done} of ${total} steps`,
    steps: ["Strategy ready", "Page live", "Marketing approved", "Payments connected"],
    views: "Visits",
    contacts: "Contacts",
    unread: "Unread chats",
    projects: "Your projects",
    projectsSub: "Each one is a service you sell.",
    all: "All",
    live: "Live",
    draft: "Draft",
    edit: "Edit",
    done: "Done",
    open: "Open",
    pageLive: "Live",
    pageDraft: "Draft",
    explore: "Explore Sevrii",
    exploreSub: "Everything to sell your service.",
    pillars: {
      plan: ["Brain", "Your offer and your strategy, in one chat."],
      store: ["Store", "Your page and the agent that serves customers."],
      marketing: ["Marketing", "Your ads on Facebook and Instagram."],
      payments: ["Payments", "Get paid by card on your page."],
      affiliates: ["Affiliates", "Others sell your service for a commission."],
    },
    go: "Open",
  },
};

// Inicio: a greeting, the one next step, how far the project is, its numbers,
// every project as a photo card and the pillars to explore.
export default function ProjectsView({
  projects,
  activeId,
  onNavigate,
  projectLimit = MAX_PROJECTS,
  business,
  unreadChats = 0,
  userEmail = "",
}: {
  projectLimit?: number;
  projects: ClientProject[];
  activeId: string;
  onNavigate: (view: DashboardView) => void;
  business: ClientBusiness;
  unreadChats?: number;
  userEmail?: string;
}) {
  const lang = useLang();
  const pt = PROJECTS_TEXT[lang];
  const tx = TEXT[lang];
  const lk = PLANS_TEXT[lang].lock;
  const [pending, start] = useTransition();
  const [filter, setFilter] = useState<"all" | "live" | "draft">("all");
  const [editing, setEditing] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const atLimit = projects.length >= Math.min(MAX_PROJECTS, projectLimit);

  const active = projects.find((p) => p.id === activeId);
  const name = firstName(business.site.ownerName || active?.ownerName || "", userEmail);
  const approved = Boolean(business.marketing.approvedAt);
  const steps = [business.plan.ready, business.published, approved, business.payReady];
  const done = steps.filter(Boolean).length;

  // The one thing to do next in the open project.
  const next: { title: string; sub: string; view: DashboardView } =
    unreadChats > 0
      ? { title: tx.next.chats(unreadChats), sub: tx.next.chatsSub, view: "chats" }
      : !business.plan.ready
        ? { title: tx.next.plan, sub: tx.next.planSub, view: "plan" }
        : !business.published
          ? { title: tx.next.store, sub: tx.next.storeSub, view: "store" }
          : !approved
            ? { title: tx.next.marketing, sub: tx.next.marketingSub, view: "marketing" }
            : { title: tx.next.running, sub: tx.next.runningSub, view: "marketing" };

  const shown = projects.filter((p) => (filter === "live" ? p.published : filter === "draft" ? !p.published : true));
  const cover = business.site.coverUrl || active?.coverUrl || "";
  const contacts = business.callClicks + business.textClicks + business.whatsappClicks;

  return (
    <div className="min-h-[calc(100dvh-var(--hdr))] md:min-h-screen bg-pbg">
      <div className="max-w-[1120px] mx-auto px-4 md:px-10 pt-5 md:pt-14 pb-12 md:pb-20 flex flex-col gap-5 md:gap-6">
        {/* Greeting */}
        <header className="pt-1 pb-2 md:pb-4">
          <h1 className="p-display">{tx.hello(name)}</h1>
          <p className="p-display p-display-sub mt-0.5">{tx.sub(business.name)}</p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-[1.35fr_1fr] gap-5 md:gap-6">
          {/* Pick up where you left off */}
          <section className="p-card p-5 md:p-7 flex flex-col gap-5">
            <div className="flex items-start gap-4">
              <div className="min-w-0 grow flex flex-col gap-1.5">
                <span className="p-eyebrow">{business.name}</span>
                <span className="text-[24px] md:text-[28px] leading-[1.15] font-medium tracking-[-0.02em] text-pfg">{next.title}</span>
                <span className="text-[15.5px] md:text-[16.5px] text-pmuted leading-snug">{next.sub}</span>
              </div>
              <Thumb src={cover} label={business.name} size={96} />
            </div>
            <button type="button" onClick={() => onNavigate(next.view)} className="p-btn full">
              {tx.continue}
            </button>
          </section>

          {/* Progress ring + checklist */}
          <section className="p-card p-5 md:p-7 flex items-center gap-5 md:gap-6">
            <Ring value={done / steps.length} label={`${done}/${steps.length}`} />
            <div className="min-w-0 flex flex-col gap-2">
              <span className="text-[20px] font-medium tracking-[-0.01em] text-pfg">{tx.progress}</span>
              <span className="text-[14px] text-pmuted -mt-1.5">{tx.progressSub(done, steps.length)}</span>
              <ul className="flex flex-col gap-1.5 mt-1">
                {tx.steps.map((s, i) => (
                  <li key={s} className="flex items-center gap-2.5 text-[14.5px]" style={{ color: steps[i] ? "#0A0A0A" : "#A1A1AA" }}>
                    <span className="h-5 w-5 rounded-full flex items-center justify-center shrink-0" style={steps[i] ? { background: GREEN } : { boxShadow: "inset 0 0 0 1.5px #D4D4D8" }}>
                      {steps[i] && (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M5 12.5l4.5 4.5L19 7.5" />
                        </svg>
                      )}
                    </span>
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </div>

        {/* Numbers */}
        <section className="grid grid-cols-3 gap-3 md:gap-5">
          <Stat label={tx.views} value={business.pageViews} />
          <Stat label={tx.contacts} value={contacts} />
          <Stat label={tx.unread} value={unreadChats} accent={unreadChats > 0} onClick={() => onNavigate("chats")} />
        </section>

        {/* Projects */}
        <section className="pt-6 md:pt-10 flex flex-col gap-4">
          <div>
            <h2 className="text-[28px] md:text-[34px] leading-[1.1] font-medium tracking-[-0.025em] text-pfg">{tx.projects}</h2>
            <p className="text-[28px] md:text-[34px] leading-[1.1] font-medium tracking-[-0.025em] text-pfaint">{tx.projectsSub}</p>
          </div>
          <div className="p-rail -mx-4 px-4 md:mx-0 md:px-0">
            {(["all", "live", "draft"] as const).map((k) => (
              <button key={k} type="button" onClick={() => setFilter(k)} className={`p-chip ${filter === k ? "on" : ""}`}>
                {tx[k]}
              </button>
            ))}
            {projects.length > 1 && (
              <button
                type="button"
                onClick={() => {
                  setEditing((e) => !e);
                  setConfirmId(null);
                }}
                className={`p-chip ${editing ? "on" : ""}`}
              >
                {editing ? tx.done : tx.edit}
              </button>
            )}
          </div>

          {confirmId && (
            <div className="p-card p-5 flex flex-col gap-3" role="alertdialog">
              <span className="text-[17px] font-medium text-pfg break-words">{pt.deleteAsk(projects.find((p) => p.id === confirmId)?.name ?? "")}</span>
              <span className="text-[14px] text-pmuted leading-relaxed">{pt.deleteWarn}</span>
              {deleteError && <span className="text-[13px] text-red-600">{deleteError}</span>}
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      setDeleteError("");
                      const res = await deleteProjectAction(confirmId);
                      if (res?.error) setDeleteError(res.error === "invalid" ? pt.deleteFailed : res.error);
                      else setConfirmId(null);
                    })
                  }
                  className="p-btn sm"
                  style={{ background: "#B42318" }}
                >
                  {pending ? pt.deleting : pt.deleteYes}
                </button>
                <button type="button" onClick={() => setConfirmId(null)} className="p-btn sm light" style={{ boxShadow: "0 0 0 1px rgba(10,10,10,.1)" }}>
                  {pt.cancel}
                </button>
              </div>
            </div>
          )}

          <div className={`p-rail -mx-4 px-4 md:mx-0 md:px-0 ${pending ? "opacity-60 pointer-events-none" : ""}`}>
            {shown.map((p) => {
              const isOpen = p.id === activeId;
              return (
                <div key={p.id} className="relative w-[248px] md:w-[280px]">
                  <button
                    type="button"
                    onClick={() => (isOpen ? onNavigate("plan") : start(() => switchProjectAction(p.id)))}
                    className="group relative block w-full h-[320px] md:h-[352px] rounded-[28px] overflow-hidden text-left transition hover:-translate-y-0.5"
                    style={{ boxShadow: isOpen ? `0 0 0 2.5px ${GREEN}` : "0 10px 30px -14px rgba(10,10,10,.25)" }}
                  >
                    {p.coverUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center" style={{ background: `linear-gradient(160deg, ${GREEN} 0%, ${DEEP} 70%)` }}>
                        <span className="text-[64px] font-medium tracking-[-0.04em] text-white/90">{initials(p.name)}</span>
                      </div>
                    )}
                    <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,.62) 100%)" }} />
                    <span className="absolute top-4 left-4 flex gap-1.5">
                      <Tag>{p.published ? tx.pageLive : tx.pageDraft}</Tag>
                      {isOpen && <Tag green>{tx.open}</Tag>}
                    </span>
                    <span className="absolute left-5 right-5 bottom-5 flex flex-col gap-0.5 text-white">
                      <span className="text-[13px] opacity-85 truncate">{p.planService || p.category}</span>
                      <span className="text-[24px] leading-[1.1] font-medium tracking-[-0.02em] break-words line-clamp-2">{p.name}</span>
                      <span className="text-[13px] opacity-85 mt-1">
                        {p.pageViews} {pt.views} · {pt.services(p.services)}
                      </span>
                    </span>
                  </button>
                  {editing && !isOpen && (
                    <button
                      type="button"
                      aria-label={pt.delete}
                      onClick={() => {
                        setDeleteError("");
                        setConfirmId(p.id);
                      }}
                      className="absolute top-3 right-3 h-9 w-9 rounded-full bg-white text-pfg flex items-center justify-center shadow"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                        <path d="M6 6l12 12M18 6L6 18" />
                      </svg>
                    </button>
                  )}
                </div>
              );
            })}

            {atLimit && projectLimit >= MAX_PROJECTS ? (
              <div className="w-[248px] md:w-[280px] h-[320px] md:h-[352px] p-card p-6 flex items-center justify-center text-center text-[15px] text-pmuted">{pt.limit}</div>
            ) : atLimit ? (
              <button type="button" onClick={() => onNavigate("plans")} className="w-[248px] md:w-[280px] h-[320px] md:h-[352px] p-card p-6 flex flex-col items-center justify-center gap-3 text-center">
                <span className="h-14 w-14 rounded-full bg-psoft flex items-center justify-center">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0A0A0A" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="5" y="11" width="14" height="9" rx="2" />
                    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
                  </svg>
                </span>
                <span className="text-[18px] font-medium text-pfg">{lk.projectsLocked(projectLimit)}</span>
                <span className="text-[14px] text-pmuted">{lk.projectsLockedSub}</span>
                <span className="p-btn sm mt-1">{lk.seePlans}</span>
              </button>
            ) : (
              <a href="/start?new=1" className="w-[248px] md:w-[280px] h-[320px] md:h-[352px] p-card p-6 flex flex-col items-center justify-center gap-3 text-center transition hover:-translate-y-0.5">
                <span className="h-14 w-14 rounded-full bg-pfg text-white flex items-center justify-center text-[28px] leading-none">+</span>
                <span className="text-[19px] font-medium text-pfg">{pt.newProject}</span>
                <span className="text-[14px] text-pmuted px-2">{pt.newProjectSub}</span>
              </a>
            )}
          </div>
        </section>

        {/* Explore the pillars */}
        <section className="pt-6 md:pt-10 flex flex-col gap-4">
          <div>
            <h2 className="text-[28px] md:text-[34px] leading-[1.1] font-medium tracking-[-0.025em] text-pfg">{tx.explore}</h2>
            <p className="text-[28px] md:text-[34px] leading-[1.1] font-medium tracking-[-0.025em] text-pfaint">{tx.exploreSub}</p>
          </div>
          <div className="p-rail -mx-4 px-4 md:mx-0 md:px-0">
            {(
              [
                ["plan", { background: DEEP, color: "#fff" }],
                ["store", { background: "#0A0A0A", color: "#fff" }],
                ["marketing", { background: GREEN, color: "#fff" }],
                ["payments", { background: "#fff", color: "#0A0A0A" }],
                ["affiliates", { background: TINT, color: DEEP }],
              ] as const
            ).map(([id, style]) => {
              const [title, line] = tx.pillars[id];
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onNavigate(id)}
                  className="w-[220px] md:w-[248px] h-[248px] md:h-[272px] rounded-[28px] p-5 md:p-6 flex flex-col justify-between text-left transition hover:-translate-y-0.5"
                  style={{ ...style, boxShadow: "0 10px 30px -14px rgba(10,10,10,.22)" }}
                >
                  <PillarIcon id={id} />
                  <span className="flex flex-col gap-1.5">
                    <span className="text-[26px] leading-none font-medium tracking-[-0.02em]">{title}</span>
                    <span className="text-[14.5px] leading-snug opacity-75">{line}</span>
                    <span className="mt-2 inline-flex items-center gap-1.5 text-[14px] font-medium">
                      {tx.go}
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M9 6l6 6-6 6" />
                      </svg>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <p className="sr-only">
          {PLAN_TEXT[lang].nav.projects}: {projects.length}
        </p>
      </div>
    </div>
  );
}

function Thumb({ src, label, size }: { src: string; label: string; size: number }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" className="rounded-[20px] object-cover shrink-0" style={{ width: size, height: size }} />
  ) : (
    <span className="rounded-[20px] shrink-0 flex items-center justify-center text-white text-[26px] font-medium" style={{ width: size, height: size, background: `linear-gradient(150deg, ${GREEN} 0%, ${DEEP} 75%)` }}>
      {initials(label)}
    </span>
  );
}

function Ring({ value, label }: { value: number; label: string }) {
  const r = 46;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative shrink-0 h-[112px] w-[112px] md:h-[124px] md:w-[124px]">
      <svg viewBox="0 0 112 112" className="h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="56" cy="56" r={r} fill="none" strokeWidth="10" className="p-ring-track" />
        <circle cx="56" cy="56" r={r} fill="none" strokeWidth="10" strokeLinecap="round" className="p-ring-fill" strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0.02, Math.min(1, value)))} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[24px] font-medium tracking-[-0.02em] text-pfg">{label}</span>
    </span>
  );
}

function Stat({ label, value, accent = false, onClick }: { label: string; value: number; accent?: boolean; onClick?: () => void }) {
  const body = (
    <>
      <span className="text-[13px] md:text-[14px] text-pmuted">{label}</span>
      <span className="text-[30px] md:text-[40px] leading-none font-medium tracking-[-0.03em] tabular-nums" style={{ color: accent ? "#15803D" : "#0A0A0A" }}>
        {value.toLocaleString("en-US")}
      </span>
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className="p-card p-4 md:p-6 flex flex-col gap-3 text-left">
      {body}
    </button>
  ) : (
    <div className="p-card p-4 md:p-6 flex flex-col gap-3">{body}</div>
  );
}

function Tag({ children, green = false }: { children: React.ReactNode; green?: boolean }) {
  return (
    <span className="h-7 px-3 rounded-full text-[12.5px] font-medium flex items-center" style={green ? { background: GREEN, color: "#fff" } : { background: "rgba(255,255,255,.92)", color: "#0A0A0A" }}>
      {children}
    </span>
  );
}

function PillarIcon({ id }: { id: "plan" | "store" | "marketing" | "payments" | "affiliates" }) {
  const d: Record<typeof id, React.ReactNode> = {
    plan: (
      <>
        <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
        <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
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
      </>
    ),
    affiliates: (
      <>
        <circle cx="8" cy="8" r="3" />
        <circle cx="17" cy="15" r="3" />
        <path d="M10.4 9.8l4.2 3.4" />
      </>
    ),
  };
  return (
    <span className="h-12 w-12 rounded-full flex items-center justify-center" style={{ boxShadow: "inset 0 0 0 1.5px currentColor" }}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {d[id]}
      </svg>
    </span>
  );
}
