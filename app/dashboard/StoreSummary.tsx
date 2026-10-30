"use client";

import { useEffect, useState } from "react";
import { useLang } from "@/components/LangProvider";
import { ACCENT, BRAND_BTN, TINT } from "@/lib/panel";
import { agentMissing, money, taskMissing } from "@/lib/serviceAgentConfig";
import { agentSalesAction, setAgentEnabledAction, type AgentSales } from "@/app/storeActions";
import { MARKET_CATEGORY_EN, type MarketCategory } from "@/lib/marketCategories";
import { toClientBusiness, type ClientBusiness, type ClientService } from "./types";

const HAIR = "rgba(10,10,10,0.068)";
const AMBER = "#B45309";

const TEXT = {
  es: {
    eyebrow: "Tu página",
    draft: "Borrador",
    live: "Publicada",
    see: "Ver mi página",
    services: "Servicios",
    more: (n: number) => `y ${n} más`,
    online: { us: "En línea · todo EE. UU.", state: (s: string) => `En línea · solo ${s}`, world: "En línea · EE. UU. y otros países" },
    local: (c: string, s: string, r: number) => `${c}${s ? `, ${s}` : ""} · hasta ${r} millas`,
    offer: "Oferta",
    hours: "Horario",
    noHours: "Sin horario",
    missing: "Para que venda más te falta:",
    mediaHow: "Las páginas con fotos y video reales del trabajo reciben muchos más mensajes. Súbelos con el botón + del chat y yo los acomodo.",
    addMedia: "Subir fotos o video",
    items: { photos: "fotos de tus trabajos", photo: "tu foto (para que vean quién lo creó)", video: "un video corto tuyo", hours: "tu horario", owner: "tu nombre (sale en «Creado por» y en el chat)" },
    planNew: "Tu estrategia está aprobada y tu página aún no la tiene.",
    planChanged: "Hay una versión más nueva de tu página con lo que aprobaste en el Cerebro (textos completos, sin cortes). Actualízala para verla.",
    build: "Armar mi página",
    update: "Actualizar mi página",
    building: "Armando…",
    failed: "No se pudo. Inténtalo de nuevo.",
    agent: "Tu agente",
    agentArea: "Configurar en Agente",
    on: "Activo",
    off: "Apagado",
    turnOn: "Activar",
    turnOff: "Apagar",
    saving: "Guardando…",
    free: (n: number) => (n === 0 ? "sin prueba gratis" : n === 1 ? "1 respuesta gratis" : `${n} respuestas gratis`),
    notes: (n: number) => (n ? "ya tiene su base de conocimiento" : "aún sin base de conocimiento"),
    needs: "Para activarlo falta:",
    needItems: { name: "su nombre", role: "qué hace", instructions: "su método", "task.goal": "la tarea que termina de punta a punta", "task.platforms": "en qué páginas oficiales opera", "task.verify": "cómo comprueba que quedó hecho", "task.deliver": "qué le entrega al cliente" } as Record<string, string>,
    task: "Lo que hace",
    taskWhere: "Opera en",
    taskSensitive: "El cliente escribe en la página oficial",
    taskVerify: "Lo da por hecho cuando",
    taskOld: "Este agente aún solo guía: dile al chat qué tarea termina de punta a punta para que la haga él.",
    taskHow: "Dile al chat qué hace de punta a punta: en qué páginas entra, qué datos delicados escribe el cliente y cuándo, y cómo comprueba que quedó hecho.",
    pay: "Para cobrar conecta Payments; mientras tanto da sus respuestas gratis y te pasa la conversación.",
    payOff: "Para cobrar también tendrás que conectar Payments. Mientras esté apagado no responde en tu página.",
    payBtn: "Conectar",
    sales: (n: number, total: string) => `${n === 1 ? "1 venta" : `${n} ventas`} · ${total}`,
  },
  en: {
    eyebrow: "Your page",
    draft: "Draft",
    live: "Published",
    see: "See my page",
    services: "Services",
    more: (n: number) => `and ${n} more`,
    online: { us: "Online · all of the US", state: (s: string) => `Online · ${s} only`, world: "Online · US and other countries" },
    local: (c: string, s: string, r: number) => `${c}${s ? `, ${s}` : ""} · up to ${r} miles`,
    offer: "Offer",
    hours: "Hours",
    noHours: "No hours",
    missing: "To sell more it still needs:",
    mediaHow: "Pages with real photos and video of the work get many more messages. Upload them with the chat's + button and I'll place them.",
    addMedia: "Upload photos or video",
    items: { photos: "photos of your work", photo: "your photo (so people see who made it)", video: "a short video of you", hours: "your hours", owner: "your name (shown in the chat)" },
    planNew: "Your strategy is approved and your page doesn't have it yet.",
    planChanged: "There's a newer version of your page with what you approved in the Brain (full texts, nothing cut). Update it to see it.",
    build: "Build my page",
    update: "Update my page",
    building: "Building…",
    failed: "That didn't work. Try again.",
    agent: "Your agent",
    agentArea: "Set up in Agent",
    on: "Live",
    off: "Off",
    turnOn: "Switch on",
    turnOff: "Switch off",
    saving: "Saving…",
    free: (n: number) => (n === 0 ? "no free trial" : n === 1 ? "1 free reply" : `${n} free replies`),
    notes: (n: number) => (n ? "has its knowledge base" : "no knowledge base yet"),
    needs: "To switch it on it needs:",
    needItems: { name: "its name", role: "what it does", instructions: "its method", "task.goal": "the task it finishes end to end", "task.platforms": "which official pages it operates", "task.verify": "how it proves it's done", "task.deliver": "what the customer receives" } as Record<string, string>,
    task: "What it does",
    taskWhere: "Works on",
    taskSensitive: "The customer types on the official page",
    taskVerify: "Done when",
    taskOld: "This agent still only guides: tell the chat which task it finishes end to end so it does it itself.",
    taskHow: "Tell the chat what it does end to end: which pages it enters, which sensitive data the customer types and when, and how it proves it's done.",
    pay: "To charge, connect Payments; meanwhile it gives its free replies and passes the chat to you.",
    payOff: "To charge you'll also need to connect Payments. While it's off it doesn't answer on your page.",
    payBtn: "Connect",
    sales: (n: number, total: string) => `${n === 1 ? "1 sale" : `${n} sales`} · ${total}`,
  },
};

// The first thing in the Store chat: what the page has now, what it still
// lacks and (for an agent) whether it's on. Changes are asked in the chat.
export default function StoreSummary({
  business,
  services,
  planPending,
  filling,
  fillError,
  onFill,
  onOpenPage,
  onUpdated,
  onPayments,
  onAgent,
  onAddMedia,
}: {
  onAgent?: () => void;
  // Opens the photo/video picker of the Store chat.
  onAddMedia?: () => void;
  business: ClientBusiness;
  services: ClientService[];
  planPending: boolean;
  filling: boolean;
  fillError: boolean;
  onFill: () => void;
  onOpenPage: () => void;
  onUpdated: (b: ClientBusiness) => void;
  onPayments?: () => void;
}) {
  const lang = useLang();
  const t = TEXT[lang];
  const s = business.site;
  const a = business.serviceAgent;
  const isAgent = business.plan.mode === "agent" || Boolean(a.name);

  const where =
    s.reachMode === "remote"
      ? s.reachScope === "world"
        ? t.online.world
        : s.reachScope === "state" && s.baseState
          ? t.online.state(s.baseState)
          : t.online.us
      : s.reachMode === "local" && s.baseCity
        ? t.local(s.baseCity, [s.baseState, s.baseZip].filter(Boolean).join(" "), s.reachRadius)
        : "";
  const mediaMissing = (isAgent ? !s.ownerPhotoUrl && !s.coverUrl : s.gallery.length === 0 && !s.coverUrl) || !s.videoUrl;
  const missing = [
    isAgent ? (!s.ownerPhotoUrl && !s.coverUrl ? t.items.photo : "") : s.gallery.length === 0 && !s.coverUrl ? t.items.photos : "",
    !s.videoUrl ? t.items.video : "",
    !isAgent && !s.hours ? t.items.hours : "",
    !s.ownerName ? t.items.owner : "",
  ].filter(Boolean);
  const category = business.marketCategory
    ? lang === "es"
      ? business.marketCategory
      : MARKET_CATEGORY_EN[business.marketCategory as MarketCategory] ?? business.marketCategory
    : "";
  const shown = services.slice(0, 4);

  return (
    <div className="rounded-[24px] p-4 md:p-5 flex flex-col gap-4 min-w-0" style={{ background: "#FFFFFF", boxShadow: "0 1px 2px rgba(10,10,10,.04), 0 10px 30px -14px rgba(10,10,10,.14), 0 0 0 1px rgba(10,10,10,.05)" }}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-pmuted">{t.eyebrow}</span>
          <span
            className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-[11.5px] font-medium truncate"
            style={business.published ? { background: TINT, color: ACCENT } : { background: "rgba(10,10,10,0.051)", color: "#52525B" }}
          >
            {business.published ? `${t.live}${category ? ` · ${category}` : ""}` : t.draft}
          </span>
        </div>
        <button type="button" onClick={onOpenPage} className="h-8 px-3.5 rounded-full text-[12.5px] font-semibold shrink-0" style={BRAND_BTN}>
          {t.see}
        </button>
      </div>

      <div className="min-w-0 flex flex-col gap-1">
        <span className="text-[18px] font-semibold text-pfg break-words leading-snug">{business.name}</span>
        {s.headline && <span className="text-[13.5px] text-psub leading-relaxed line-clamp-2">{s.headline}</span>}
      </div>

      {planPending && (
        <div className="rounded-xl p-3 flex flex-col sm:flex-row sm:items-center gap-3 justify-between" style={{ background: "rgba(22,163,74,0.12)", boxShadow: "inset 0 0 0 1px rgba(22,163,74,0.12)" }}>
          <div className="min-w-0">
            <p className="text-[13px] text-pfg leading-relaxed">{s.fromPlan ? t.planChanged : t.planNew}</p>
            {fillError && <p className="text-[12.5px] mt-1 text-red-600">{t.failed}</p>}
          </div>
          <button type="button" disabled={filling} onClick={onFill} className="h-9 px-4 rounded-full text-[13px] font-semibold shrink-0 self-start sm:self-auto disabled:opacity-60" style={BRAND_BTN}>
            {filling ? t.building : s.fromPlan ? t.update : t.build}
          </button>
        </div>
      )}

      {shown.length > 0 && (
        <div className="flex flex-col">
          {shown.map((x) => (
            <div key={x.id} className="flex items-baseline justify-between gap-4 py-2" style={{ borderTop: `1px solid ${HAIR}` }}>
              <span className="text-[14px] text-pfg min-w-0 truncate">{x.name}</span>
              {x.price && <span className="text-[14px] font-medium text-pfg shrink-0 tabular-nums">{x.price}</span>}
            </div>
          ))}
          {services.length > shown.length && (
            <span className="text-[12.5px] text-pmuted pt-1">{t.more(services.length - shown.length)}</span>
          )}
        </div>
      )}

      {(where || (!isAgent && s.hours) || s.offer) && (
        <div className="flex flex-wrap gap-2">
          {[where, !isAgent && s.hours ? `${t.hours}: ${s.hours}` : "", s.offer ? `${t.offer}: ${s.offer.label}` : ""].filter(Boolean).map((x) => (
            <span key={x} className="text-[12.5px] text-pfg2 px-3 py-1.5 rounded-full max-w-full truncate" style={{ background: "rgba(10,10,10,0.034)", boxShadow: `inset 0 0 0 1px ${HAIR}` }}>
              {x}
            </span>
          ))}
        </div>
      )}

      {/* The agent itself is set up in its own area (Agente, right below Store). */}
      {isAgent && (
        <button type="button" onClick={onAgent} className="flex items-center justify-between gap-3 pt-3 text-left" style={{ borderTop: `1px solid ${HAIR}` }}>
          <span className="min-w-0 flex flex-col">
            <span className="text-[12px] text-pmuted">{t.agent}</span>
            <span className="text-[14.5px] font-medium text-pfg truncate">{a.name || "—"}</span>
          </span>
          <span className="flex items-center gap-2 shrink-0">
            <span className="inline-flex items-center gap-1.5 text-[12px]" style={{ color: a.enabled ? ACCENT : "#52525B" }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: a.enabled ? ACCENT : "#A1A1AA" }} />
              {a.enabled ? t.on : t.off}
            </span>
            <span className="text-[12.5px] font-semibold" style={{ color: ACCENT }}>{t.agentArea} →</span>
          </span>
        </button>
      )}

      {missing.length > 0 && (
        <div className="rounded-xl p-3 flex flex-col sm:flex-row sm:items-center gap-3 justify-between" style={{ background: "rgba(245,158,11,0.07)", boxShadow: "inset 0 0 0 1px rgba(245,158,11,0.25)" }}>
          <p className="text-[13px] leading-relaxed text-pfg min-w-0">
            <span className="font-semibold" style={{ color: AMBER }}>{`${t.missing} `}</span>
            {`${missing.join(", ")}.`}
            {mediaMissing && <span className="block text-[12.5px] text-psub mt-0.5">{t.mediaHow}</span>}
          </p>
          {mediaMissing && onAddMedia && (
            <button type="button" onClick={onAddMedia} className="h-9 px-4 rounded-full text-[13px] font-semibold shrink-0 self-start sm:self-auto" style={BRAND_BTN}>
              {t.addMedia}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function AgentRow({ business, onUpdated, onPayments, bare = false }: { business: ClientBusiness; onUpdated: (b: ClientBusiness) => void; onPayments?: () => void; bare?: boolean }) {
  const lang = useLang();
  const t = TEXT[lang];
  const a = business.serviceAgent;
  const gaps = taskMissing(a.task);
  // To switch it on it also needs its complete task (an agent that's already on keeps working).
  const needs = [...agentMissing(a), ...(a.enabled ? [] : gaps.map((g) => `task.${g}`))];
  const [busy, setBusy] = useState(false);
  const [sales, setSales] = useState<AgentSales | null>(null);

  useEffect(() => {
    let alive = true;
    agentSalesAction()
      .then((x) => alive && setSales(x))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [business.id]);

  async function toggle() {
    setBusy(true);
    try {
      const res = await setAgentEnabledAction(!a.enabled);
      onUpdated(toClientBusiness(res.business));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`flex flex-col gap-2.5 ${bare ? "" : "pt-3"}`} style={bare ? undefined : { borderTop: `1px solid ${HAIR}` }}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex flex-col">
          <span className="text-[12px] text-pmuted">{t.agent}</span>
          <span className="text-[14.5px] font-medium text-pfg truncate">{a.name || "—"}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="inline-flex items-center gap-1.5 text-[12px]" style={{ color: a.enabled ? ACCENT : "#52525B" }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: a.enabled ? ACCENT : "#A1A1AA" }} />
            {a.enabled ? t.on : t.off}
          </span>
          <button
            type="button"
            disabled={busy || (!a.enabled && needs.length > 0)}
            onClick={toggle}
            className="h-8 px-3.5 rounded-full text-[12.5px] font-semibold disabled:opacity-45"
            style={a.enabled ? { background: "rgba(10,10,10,0.068)", color: "#0A0A0A" } : BRAND_BTN}
          >
            {busy ? t.saving : a.enabled ? t.turnOff : t.turnOn}
          </button>
        </div>
      </div>
      <span className="text-[12.5px] text-psub">
        {t.free(a.freeReplies)} · {t.notes(a.knowledge.length)}
        {sales && sales.count ? ` · ${t.sales(sales.count, money(sales.totalCents))}` : ""}
      </span>
      {gaps.length === 0 ? (
        <div className="flex flex-col gap-1 rounded-xl p-3 text-[12.5px] leading-relaxed" style={{ background: "rgba(10,10,10,0.034)" }}>
          <span className="text-pfg"><b className="font-semibold">{t.task}:</b> {a.task.goal}</span>
          <span className="text-psub">{t.taskWhere}: {a.task.platforms.map((p) => p.name).join(", ")}</span>
          {a.task.sensitive.length > 0 && <span className="text-psub">{t.taskSensitive}: {a.task.sensitive.map((x) => x.what).join(", ")}</span>}
          <span className="text-psub">{t.taskVerify}: {a.task.verify}</span>
        </div>
      ) : (
        <span className="text-[12.5px] leading-relaxed" style={{ color: AMBER }}>{a.enabled ? t.taskOld : t.taskHow}</span>
      )}
      {needs.length > 0 && (
        <span className="text-[12.5px]" style={{ color: AMBER }}>
          {t.needs} {needs.map((m) => t.needItems[m]).join(", ")}.
        </span>
      )}
      {!business.payReady && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-[12.5px] text-psub leading-relaxed">{a.enabled ? t.pay : t.payOff}</span>
          {onPayments && (
            <button type="button" onClick={onPayments} className="text-[12.5px] font-semibold shrink-0 hover:underline" style={{ color: ACCENT }}>
              {t.payBtn} →
            </button>
          )}
        </div>
      )}
    </div>
  );
}
