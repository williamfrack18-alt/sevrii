"use client";

import { useState, useTransition } from "react";
import { useLang } from "@/components/LangProvider";
import { PLAN_TEXT, PROJECTS_TEXT } from "@/lib/planI18n";
import { PLANS_TEXT } from "@/lib/plansI18n";
import { deleteProjectAction, switchProjectAction } from "@/app/actions";
import type { ClientBusiness, ClientProject, DashboardView } from "./types";
import { GREEN } from "@/lib/panel";

const MAX_PROJECTS = 10;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

// The owner's first name as they wrote it on their page ("Carlos Ruiz" → "Carlos"); none → just "Hola".
function firstName(owner: string): string {
  return owner.trim().split(/\s+/)[0] || "";
}

// Photo-less project cards: black and graphite, never a washed-out green.
const FILLS = [
  "linear-gradient(160deg, #262626 0%, #0A0A0A 70%)",
  "linear-gradient(160deg, #303030 0%, #141414 70%)",
  "linear-gradient(160deg, #1C1C1C 0%, #050505 70%)",
];

const TEXT = {
  es: {
    hello: (n: string) => (n ? `Hola, ${n}` : "Hola"),
    sub: "Estos son tus proyectos.",
    nextHead: "Esto es lo que sigue.",
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
      payments: "Conecta Pagos",
      paymentsSub: "Para cobrar a tus clientes desde tu página.",
      running: "Revisa tu marketing",
      runningSub: "Da el OK a cada campaña antes de lanzarla y mira sus resultados.",
    },
    progress: "Tu avance",
    progressSub: (done: number, total: number) => `${done} de ${total} pasos`,
    // The real order: strategy → page → payments (to charge) → ads.
    steps: ["Estrategia lista", "Página publicada", "Pagos conectados", "Marketing aprobado"],
    early: (prev: string) => `Pendiente: cuenta cuando completes «${prev}»`,
    views: "Visitas",
    contacts: "Contactos",
    unread: "Chats sin leer",
    edit: "Editar",
    done: "Listo",
    open: "Abierto",
    pageLive: "Publicada",
    pageDraft: "Borrador",
  },
  en: {
    hello: (n: string) => (n ? `Hi, ${n}` : "Hi"),
    sub: "Here are your projects.",
    nextHead: "Here's what's next.",
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
      payments: "Connect Payments",
      paymentsSub: "To charge your customers from your page.",
      running: "Check your marketing",
      runningSub: "Give your OK to each campaign before it launches and see its results.",
    },
    progress: "Your progress",
    progressSub: (done: number, total: number) => `${done} of ${total} steps`,
    steps: ["Strategy ready", "Page live", "Payments connected", "Marketing approved"],
    early: (prev: string) => `Pending: it counts once you complete "${prev}"`,
    views: "Visits",
    contacts: "Contacts",
    unread: "Unread chats",
    edit: "Edit",
    done: "Done",
    open: "Open",
    pageLive: "Live",
    pageDraft: "Draft",
  },
};

// Inicio: the greeting and every project first (as photo cards), then what's
// next in the open one: its next step, how far it is and its numbers. The tools
// live in the side menu.
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
  const [editing, setEditing] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const atLimit = projects.length >= Math.min(MAX_PROJECTS, projectLimit);

  const active = projects.find((p) => p.id === activeId);
  const name = firstName(business.site.ownerName || active?.ownerName || projects.find((p) => p.ownerName)?.ownerName || "");
  void userEmail;
  const approved = Boolean(business.marketing.approvedAt);
  const flags = [business.plan.ready, business.published, business.payReady, approved];
  // A step only counts once every step before it is done; one done ahead of
  // time shows as such instead of skipping the line.
  const steps = flags.map((f, i) => f && flags.slice(0, i).every(Boolean));
  const early = flags.map((f, i) => f && !steps[i]);
  const done = steps.filter(Boolean).length;

  // The one thing to do next in the open project.
  const next: { title: string; sub: string; view: DashboardView } =
    unreadChats > 0
      ? { title: tx.next.chats(unreadChats), sub: tx.next.chatsSub, view: "chats" }
      : !business.plan.ready
        ? { title: tx.next.plan, sub: tx.next.planSub, view: "plan" }
        : !business.published
          ? { title: tx.next.store, sub: tx.next.storeSub, view: "store" }
          : !business.payReady
            ? { title: tx.next.payments, sub: tx.next.paymentsSub, view: "payments" }
            : !approved
            ? { title: tx.next.marketing, sub: tx.next.marketingSub, view: "marketing" }
            : { title: tx.next.running, sub: tx.next.runningSub, view: "marketing" };

  const shown = projects;
  const cover = business.site.coverUrl || active?.coverUrl || "";
  const contacts = business.callClicks + business.textClicks + business.whatsappClicks;

  return (
    <div className="min-h-[calc(100dvh-var(--hdr))] md:min-h-screen">
      <div className="max-w-[1120px] mx-auto px-4 md:px-10 pt-5 md:pt-14 pb-12 md:pb-20 flex flex-col gap-5 md:gap-6">
        {/* Greeting + the projects, first */}
        <header className="flex items-end justify-between gap-3 pt-1 pb-1 md:pb-2">
          <div className="dash-on-dark min-w-0">
            <h1 className="p-display">{tx.hello(name)}</h1>
            <p className="p-display p-display-sub mt-0.5">{tx.sub}</p>
          </div>
          {projects.length > 1 && (
            <button
              type="button"
              onClick={() => {
                setEditing((e) => !e);
                setConfirmId(null);
              }}
              className={`p-chip shrink-0 ${editing ? "on" : ""}`}
            >
              {editing ? tx.done : tx.edit}
            </button>
          )}
        </header>

        <section className="flex flex-col gap-4">
          {confirmId && (
            <div className="p-card p-5 flex flex-col gap-3" role="alertdialog">
              <span className="text-[17px] font-medium text-pfg break-words">{pt.deleteAsk(projects.find((p) => p.id === confirmId)?.name ?? "")}</span>
              <span className="text-[14px] text-pmuted leading-relaxed break-words whitespace-normal">{pt.deleteWarn}</span>
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

          <div className={`p-rail -mx-4 px-4 md:mx-0 md:px-0 md:grid md:grid-cols-3 xl:grid-cols-4 md:gap-5 md:overflow-visible md:pb-0 ${pending ? "opacity-60 pointer-events-none" : ""}`}>
            {shown.map((p, idx) => {
              const isOpen = p.id === activeId;
              return (
                <div key={p.id} className="relative w-[248px] md:w-auto">
                  <button
                    type="button"
                    onClick={() => (isOpen ? onNavigate("plan") : start(() => switchProjectAction(p.id)))}
                    className="group relative block w-full h-[300px] md:h-[280px] rounded-[28px] overflow-hidden text-left transition hover:-translate-y-0.5"
                    style={{ boxShadow: isOpen ? `0 0 0 2.5px ${GREEN}` : "0 10px 30px -14px rgba(10,10,10,.25)" }}
                  >
                    {p.coverUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center pb-[96px]" style={{ background: FILLS[projects.indexOf(p) % FILLS.length] ?? FILLS[idx % FILLS.length] }}>
                        <span className="text-[56px] font-medium tracking-[-0.04em] text-white/90">{initials(p.name)}</span>
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
                        {`${p.pageViews} ${pt.views} · ${pt.services(p.services)}`}
                      </span>
                    </span>
                  </button>
                  {/* Every project can be deleted, the open one too (with the same confirmation). */}
                  {editing && (
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
              <div className="w-[248px] md:w-auto h-[300px] md:h-[280px] p-card p-6 flex items-center justify-center text-center text-[15px] text-pmuted">{pt.limit}</div>
            ) : atLimit ? (
              <button type="button" onClick={() => onNavigate("plans")} className="w-[248px] md:w-auto h-[300px] md:h-[280px] p-card p-6 flex flex-col items-center justify-center gap-3 text-center">
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
              <a href="/start?new=1" className="w-[248px] md:w-auto h-[300px] md:h-[280px] p-card p-6 flex flex-col items-center justify-center gap-3 text-center transition hover:-translate-y-0.5">
                <span className="h-14 w-14 rounded-full bg-pfg text-white flex items-center justify-center text-[28px] leading-none">+</span>
                <span className="text-[19px] font-medium text-pfg">{pt.newProject}</span>
                <span className="text-[14px] text-pmuted px-2">{pt.newProjectSub}</span>
              </a>
            )}
          </div>
        </section>

        {/* Below: what's next in the open project */}
        <div className="dash-on-dark pt-6 md:pt-10">
          <h2 className="text-[28px] md:text-[34px] leading-[1.1] font-medium tracking-[-0.025em] text-pfg break-words">{business.name}</h2>
          <p className="text-[28px] md:text-[34px] leading-[1.1] font-medium tracking-[-0.025em] text-pfaint">{tx.nextHead}</p>
        </div>

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
                    <span className="min-w-0">
                      {s}
                      {early[i] && <span className="block text-[12px] text-pmuted leading-snug">{tx.early(tx.steps[flags.findIndex((f) => !f)] ?? "")}</span>}
                    </span>
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
    <span className="rounded-[20px] shrink-0 flex items-center justify-center text-white text-[26px] font-medium" style={{ width: size, height: size, background: "linear-gradient(150deg, #262626 0%, #0A0A0A 75%)" }}>
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
