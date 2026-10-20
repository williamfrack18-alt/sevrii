"use client";

import { useEffect, useState } from "react";
import { useLang } from "@/components/LangProvider";
import { ACCENT, BRAND_BTN, RING, TINT } from "@/lib/brand";
import { agentMissing, money, offerPriceLabel } from "@/lib/serviceAgentConfig";
import { agentSalesAction, setAgentEnabledAction, type AgentSales } from "@/app/storeActions";
import { toClientBusiness, type ClientBusiness } from "./types";

const AMBER = "#f5c451";
const HAIR = "rgba(255,255,255,0.08)";
const INSET = { background: "rgba(255,255,255,0.04)", boxShadow: `inset 0 0 0 1px ${HAIR}` } as const;

const TEXT = {
  es: {
    eyebrow: "Tu agente",
    on: "Activo en tu página",
    off: "Apagado",
    turnOn: "Activar en mi página",
    turnOff: "Apagar",
    working: "Guardando…",
    free: (n: number) => (n === 0 ? "Sin prueba gratis" : n === 1 ? "1 respuesta gratis antes de pagar" : `${n} respuestas gratis antes de pagar`),
    knowledge: (n: number) => (n ? `Conoce ${n.toLocaleString("es-US")} caracteres de tus apuntes` : "Todavía no le has enseñado tus apuntes"),
    limits: (n: number) => (n === 1 ? "1 límite" : `${n} límites`),
    offers: "Lo que pagan tus clientes",
    noOffers: "Sin precios todavía. Díselos al chat de arriba (desde $15).",
    payTitle: "Para cobrar, conecta Payments",
    payText: "Mientras tanto, tu agente da sus respuestas gratis y después te pasa la conversación.",
    payBtn: "Conectar Payments",
    missing: "Para activarlo falta:",
    missingItems: { name: "su nombre", role: "qué hace, en una línea", instructions: "su método paso a paso" } as Record<string, string>,
    sales: (n: number, total: string, active: number) => `${n === 1 ? "1 venta" : `${n} ventas`} · ${total}${active ? ` · ${active} con acceso ahora` : ""}`,
    noSales: "Todavía sin ventas",
    hint: "Para cambiar algo, díselo al chat de arriba. Pruébalo tú en “Ver borrador”: como dueño chateas gratis con él.",
  },
  en: {
    eyebrow: "Your agent",
    on: "Live on your page",
    off: "Off",
    turnOn: "Switch on in my page",
    turnOff: "Switch off",
    working: "Saving…",
    free: (n: number) => (n === 0 ? "No free trial" : n === 1 ? "1 free reply before paying" : `${n} free replies before paying`),
    knowledge: (n: number) => (n ? `Knows ${n.toLocaleString("en-US")} characters of your notes` : "You haven't taught it your notes yet"),
    limits: (n: number) => (n === 1 ? "1 limit" : `${n} limits`),
    offers: "What your customers pay",
    noOffers: "No prices yet. Tell the chat above (from $15).",
    payTitle: "To charge, connect Payments",
    payText: "Meanwhile, your agent gives its free replies and then passes the chat to you.",
    payBtn: "Connect Payments",
    missing: "To switch it on it needs:",
    missingItems: { name: "its name", role: "what it does, in one line", instructions: "its step-by-step method" } as Record<string, string>,
    sales: (n: number, total: string, active: number) => `${n === 1 ? "1 sale" : `${n} sales`} · ${total}${active ? ` · ${active} with access now` : ""}`,
    noSales: "No sales yet",
    hint: "To change something, tell the chat above. Try it yourself on “View draft”: as the owner you chat with it for free.",
  },
};

// The service agent in Store: what it is, whether it's on, what it sells.
export default function AgentCard({
  business,
  onUpdated,
  onPayments,
}: {
  business: ClientBusiness;
  onUpdated: (b: ClientBusiness) => void;
  onPayments?: () => void;
}) {
  const lang = useLang();
  const t = TEXT[lang];
  const a = business.serviceAgent;
  const missing = agentMissing(a);
  const [busy, setBusy] = useState(false);
  const [sales, setSales] = useState<AgentSales | null>(null);

  useEffect(() => {
    let alive = true;
    agentSalesAction()
      .then((s) => alive && setSales(s))
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
    <div className="rounded-2xl p-4 md:p-5 mb-5 flex flex-col gap-4 min-w-0" style={{ background: "#101010", boxShadow: `0 0 0 1px ${a.enabled ? RING : HAIR}` }}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex flex-col gap-0.5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#8e8e8e]">{t.eyebrow}</span>
          <span className="text-[17px] font-semibold text-white break-words">{a.name || "—"}</span>
          {a.role && <span className="text-[13.5px] text-[#a1a1a1] leading-relaxed">{a.role}</span>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className="inline-flex items-center gap-1.5 h-7 px-3 rounded-full text-[12px] font-medium"
            style={a.enabled ? { background: TINT, color: ACCENT } : { background: "rgba(255,255,255,0.06)", color: "#a1a1a1" }}
          >
            {a.enabled && <span className="h-1.5 w-1.5 rounded-full" style={{ background: ACCENT }} />}
            {a.enabled ? t.on : t.off}
          </span>
          <button
            type="button"
            disabled={busy || (!a.enabled && missing.length > 0)}
            onClick={toggle}
            className="h-8 px-4 rounded-full text-[13px] font-semibold disabled:opacity-45"
            style={a.enabled ? { background: "rgba(255,255,255,0.08)", color: "#e5e5e5" } : BRAND_BTN}
          >
            {busy ? t.working : a.enabled ? t.turnOff : t.turnOn}
          </button>
        </div>
      </div>

      {missing.length > 0 && (
        <p className="text-[13px] leading-relaxed" style={{ color: AMBER }}>
          {t.missing} {missing.map((m) => t.missingItems[m]).join(", ")}.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {[t.free(a.freeReplies), t.knowledge(a.knowledge.length), t.limits(a.limits.length)].map((x) => (
          <span key={x} className="text-[12.5px] text-[#d4d4d4] px-3 py-1.5 rounded-full" style={INSET}>
            {x}
          </span>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-[12px] text-[#8e8e8e]">{t.offers}</span>
        {a.offers.length ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {a.offers.map((o) => (
              <div key={o.id} className="rounded-xl p-3 flex flex-col gap-0.5 min-w-0" style={INSET}>
                <span className="text-[14px] font-medium text-white break-words">{o.title}</span>
                {o.detail && <span className="text-[12.5px] text-[#a1a1a1] leading-relaxed">{o.detail}</span>}
                <span className="text-[13px] font-semibold mt-1" style={{ color: ACCENT }}>
                  {offerPriceLabel(o, lang)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <span className="text-[13px] text-[#a1a1a1]">{t.noOffers}</span>
        )}
      </div>

      {!business.payReady && (
        <div className="rounded-xl p-3 flex flex-col sm:flex-row sm:items-center gap-3 justify-between" style={{ background: "rgba(245,196,81,0.06)", boxShadow: "inset 0 0 0 1px rgba(245,196,81,0.22)" }}>
          <div className="min-w-0">
            <div className="text-[13.5px] font-medium text-[#f3e3b5]">{t.payTitle}</div>
            <p className="text-[12.5px] text-[#d9cfae] leading-relaxed">{t.payText}</p>
          </div>
          {onPayments && (
            <button type="button" onClick={onPayments} className="h-9 px-4 rounded-full text-[13px] font-semibold shrink-0 self-start sm:self-auto" style={BRAND_BTN}>
              {t.payBtn} →
            </button>
          )}
        </div>
      )}

      <div className="flex flex-col gap-1 pt-3" style={{ borderTop: `1px solid ${HAIR}` }}>
        <span className="text-[13px] text-white">{sales && sales.count ? t.sales(sales.count, money(sales.totalCents), sales.active) : t.noSales}</span>
        <span className="text-[12.5px] text-[#8e8e8e] leading-relaxed">{t.hint}</span>
      </div>
    </div>
  );
}
