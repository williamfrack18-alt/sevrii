"use client";

import { useEffect, useState } from "react";
import { useLang } from "@/components/LangProvider";
import { ACCENT, BRAND_BTN, TINT } from "@/lib/panel";
import { agentMissing, money } from "@/lib/serviceAgentConfig";
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
    items: { photos: "fotos de tus trabajos", photo: "tu foto (para que vean quién lo creó)", video: "un video corto tuyo", hours: "tu horario", owner: "tu nombre (sale en «Creado por» y en el chat)" },
    planNew: "Tu estrategia está aprobada y tu página aún no la tiene.",
    planChanged: "Cambiaste tu estrategia en el Cerebro. Tu página todavía muestra la anterior.",
    build: "Armar mi página",
    update: "Actualizar mi página",
    building: "Armando…",
    failed: "No se pudo. Inténtalo de nuevo.",
    agent: "Tu agente",
    on: "Activo",
    off: "Apagado",
    turnOn: "Activar",
    turnOff: "Apagar",
    saving: "Guardando…",
    free: (n: number) => (n === 0 ? "sin prueba gratis" : n === 1 ? "1 respuesta gratis" : `${n} respuestas gratis`),
    notes: (n: number) => (n ? "ya tiene su base de conocimiento" : "aún sin base de conocimiento"),
    needs: "Para activarlo falta:",
    needItems: { name: "su nombre", role: "qué hace", instructions: "su método" } as Record<string, string>,
    pay: "Para cobrar conecta Payments; mientras tanto da sus respuestas gratis y te pasa la conversación.",
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
    items: { photos: "photos of your work", photo: "your photo (so people see who made it)", video: "a short video of you", hours: "your hours", owner: "your name (shown in the chat)" },
    planNew: "Your strategy is approved and your page doesn't have it yet.",
    planChanged: "You changed your strategy in the Brain. Your page still shows the old one.",
    build: "Build my page",
    update: "Update my page",
    building: "Building…",
    failed: "That didn't work. Try again.",
    agent: "Your agent",
    on: "Live",
    off: "Off",
    turnOn: "Switch on",
    turnOff: "Switch off",
    saving: "Saving…",
    free: (n: number) => (n === 0 ? "no free trial" : n === 1 ? "1 free reply" : `${n} free replies`),
    notes: (n: number) => (n ? "has its knowledge base" : "no knowledge base yet"),
    needs: "To switch it on it needs:",
    needItems: { name: "its name", role: "what it does", instructions: "its method" } as Record<string, string>,
    pay: "To charge, connect Payments; meanwhile it gives its free replies and passes the chat to you.",
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
}: {
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
        ? t.local(s.baseCity, s.baseState, s.reachRadius)
        : "";
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

      {isAgent && <AgentRow business={business} onUpdated={onUpdated} onPayments={onPayments} />}

      {missing.length > 0 && (
        <p className="text-[12.5px] leading-relaxed text-psub">
          <span style={{ color: AMBER }}>{t.missing}</span> {missing.join(", ")}.
        </p>
      )}
    </div>
  );
}

function AgentRow({ business, onUpdated, onPayments }: { business: ClientBusiness; onUpdated: (b: ClientBusiness) => void; onPayments?: () => void }) {
  const lang = useLang();
  const t = TEXT[lang];
  const a = business.serviceAgent;
  const needs = agentMissing(a);
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
    <div className="flex flex-col gap-2.5 pt-3" style={{ borderTop: `1px solid ${HAIR}` }}>
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
      {needs.length > 0 && (
        <span className="text-[12.5px]" style={{ color: AMBER }}>
          {t.needs} {needs.map((m) => t.needItems[m]).join(", ")}.
        </span>
      )}
      {!business.payReady && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-[12.5px] text-psub leading-relaxed">{t.pay}</span>
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
