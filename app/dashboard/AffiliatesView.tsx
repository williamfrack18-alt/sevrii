"use client";

import { useEffect, useState } from "react";
import { useLang } from "@/components/LangProvider";
import { ACCENT, BRAND_BTN, TINT } from "@/lib/panel";
import { AFF_MAX_PERCENT, AFF_MIN_PERCENT, type AffiliateSettings } from "@/lib/affiliateConfig";
import { affiliatePayoutAction, loadAffiliatesAction, saveAffiliateSettingsAction, type AffiliatesState, type AffSale } from "@/app/affiliateActions";
import type { ClientBusiness, DashboardView } from "./types";

const AMBER = "#B45309";
const HAIR = "rgba(10,10,10,0.068)";
const CARD = { background: "#FFFFFF", boxShadow: "0 1px 2px rgba(10,10,10,.04), 0 10px 30px -14px rgba(10,10,10,.14), 0 0 0 1px rgba(10,10,10,.05)" } as const;
const INSET = { background: "rgba(10,10,10,0.034)", boxShadow: `inset 0 0 0 1px ${HAIR}` } as const;
const GHOST = { background: "rgba(10,10,10,0.051)", color: "#0A0A0A", boxShadow: `inset 0 0 0 1px ${HAIR}` } as const;

const usd = (c: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(c / 100);

const TEXT = {
  es: {
    title: "Afiliados",
    sub: "Recomienda servicios y gana una comisión por cada venta. O abre tu servicio para que otros lo vendan por ti.",
    how: "Cómo funciona",
    tabPromote: "Promocionar y ganar",
    tabMine: "Mi servicio",
    loading: "Cargando…",
    pending: "Por cobrar",
    held: "Esperando tu cuenta",
    paid: "Pagado",
    payoutTitle: "Conecta tu cuenta para recibir tus comisiones",
    payoutText: "Sevrii te envía cada comisión 30 días después de la venta, directo a tu banco, con Stripe. Lo conectas una sola vez.",
    payoutReview: "Stripe está revisando tu cuenta. Tus comisiones te esperan.",
    payoutReady: "Tu cuenta para recibir comisiones está lista.",
    payoutBtn: "Conectar mi cuenta",
    payoutContinue: "Terminar en Stripe",
    payoutOff: "Los pagos de Sevrii todavía no están activos.",
    servicesTitle: "Servicios que puedes promocionar",
    servicesSub: "Comparte tu link. Si el cliente paga por Sevrii en los 30 días siguientes, la comisión es tuya.",
    none: "Todavía no hay servicios abiertos a afiliados. Cuando un negocio abra el suyo, aparecerá aquí.",
    agent: "Agente de IA",
    commission: (p: number) => `${p}% de comisión`,
    from: (p: string) => `Precio: ${p}`,
    ownerSays: "Lo que dice el dueño",
    copy: "Copiar link",
    copied: "Copiado",
    view: "Ver página",
    visits: (n: number) => (n === 1 ? "1 visita con tu link" : `${n} visitas con tu link`),
    mySales: "Tus ventas",
    noSales: "Todavía no tienes ventas. Comparte tu link donde esté tu público.",
    rules:
      "Reglas: di siempre que ganas una comisión, no prometas lo que el servicio no promete y no hagas spam. Solo cuentan los pagos hechos por Sevrii (links de pago y acceso a agentes); si el cliente pide reembolso, la comisión se anula.",
    status: { pending: "Por pagar", held: "Falta tu cuenta", paid: "Pagado", void: "Anulado" } as Record<string, string>,
    payDay: (d: string) => `desde el ${d}`,
    // owner
    needTitle: "Para abrir tu servicio a afiliados falta:",
    needPublish: "Publicar tu página: ahora está en borrador",
    needPlan: "Publicar tu página: tu plan actual no permite publicar (míralo en Planes)",
    lockedNote: "Podrás elegir la comisión y escribir tu mensaje cuando completes lo de arriba.",
    needPayments: "Conectar Payments, para que los clientes paguen por Sevrii",
    goStore: "Ir a Store",
    goPayments: "Ir a Payments",
    goPlans: "Ver Planes",
    open: (n: string) => `Abrir “${n}” a afiliados`,
    openSub: "Aparece en la lista de servicios para promocionar. Solo pagas cuando un afiliado te trae una venta.",
    percent: "Comisión para el afiliado",
    example: (p: number) => `En una venta de $100, el afiliado gana ${usd(p * 100)}. Se cobra junto con el 5% de Payments, solo en ventas que trae un afiliado.`,
    pitch: "Mensaje para los afiliados",
    pitchPh: (n: string) => `A quién le sirve ${n}, qué decir y qué no prometer. Ej.: para quién es, en qué estados funciona y que no se prometan resultados.`,
    save: "Guardar",
    saving: "Guardando…",
    saved: "Guardado",
    statAff: "Afiliados",
    statVisits: "Visitas",
    statSales: "Ventas",
    statCom: "Comisiones",
    ownerSales: "Ventas de afiliados",
    ownerNoSales: "Todavía no hay ventas de afiliados.",
    nobusiness: "Abre o crea un proyecto para usar esta parte.",
    failed: "No se pudo. Inténtalo de nuevo.",
  },
  en: {
    title: "Affiliates",
    sub: "Recommend services and earn a commission on every sale. Or open your service so others sell it for you.",
    how: "How it works",
    tabPromote: "Promote and earn",
    tabMine: "My service",
    loading: "Loading…",
    pending: "To be paid",
    held: "Waiting for your account",
    paid: "Paid",
    payoutTitle: "Connect your account to receive your commissions",
    payoutText: "Sevrii sends each commission 30 days after the sale, straight to your bank, with Stripe. You connect it once.",
    payoutReview: "Stripe is reviewing your account. Your commissions are waiting.",
    payoutReady: "Your account to receive commissions is ready.",
    payoutBtn: "Connect my account",
    payoutContinue: "Finish on Stripe",
    payoutOff: "Sevrii payments aren't on yet.",
    servicesTitle: "Services you can promote",
    servicesSub: "Share your link. If the customer pays through Sevrii within 30 days, the commission is yours.",
    none: "No services are open to affiliates yet. When a business opens theirs, it shows up here.",
    agent: "AI agent",
    commission: (p: number) => `${p}% commission`,
    from: (p: string) => `Price: ${p}`,
    ownerSays: "What the owner says",
    copy: "Copy link",
    copied: "Copied",
    view: "View page",
    visits: (n: number) => (n === 1 ? "1 visit from your link" : `${n} visits from your link`),
    mySales: "Your sales",
    noSales: "No sales yet. Share your link where your audience is.",
    rules:
      "Rules: always say you earn a commission, don't promise what the service doesn't, and no spam. Only payments made through Sevrii count (payment links and agent access); if the customer gets a refund, the commission is voided.",
    status: { pending: "To be paid", held: "Needs your account", paid: "Paid", void: "Voided" } as Record<string, string>,
    payDay: (d: string) => `from ${d}`,
    needTitle: "To open your service to affiliates you need:",
    needPublish: "Publish your page: it's still a draft",
    needPlan: "Publish your page: your current plan can't publish (see Plans)",
    lockedNote: "You can set the commission and write your message once the steps above are done.",
    needPayments: "Connect Payments, so customers pay through Sevrii",
    goStore: "Go to Store",
    goPayments: "Go to Payments",
    goPlans: "See Plans",
    open: (n: string) => `Open “${n}” to affiliates`,
    openSub: "It shows in the list of services to promote. You only pay when an affiliate brings you a sale.",
    percent: "Commission for the affiliate",
    example: (p: number) => `On a $100 sale, the affiliate earns ${usd(p * 100)}. It's charged with Payments' 5%, only on sales an affiliate brings.`,
    pitch: "Message for affiliates",
    pitchPh: (n: string) => `Who ${n} is for, what to say and what not to promise. E.g.: who it's for, which states it works in, and that no results are promised.`,
    save: "Save",
    saving: "Saving…",
    saved: "Saved",
    statAff: "Affiliates",
    statVisits: "Visits",
    statSales: "Sales",
    statCom: "Commissions",
    ownerSales: "Affiliate sales",
    ownerNoSales: "No affiliate sales yet.",
    nobusiness: "Open or create a project to use this part.",
    failed: "Couldn't do it. Please try again.",
  },
};

export default function AffiliatesView({ business, onNavigate }: { business: ClientBusiness | null; onNavigate?: (v: DashboardView) => void }) {
  const lang = useLang();
  const t = TEXT[lang];
  const [state, setState] = useState<AffiliatesState | null>(null);
  const [tab, setTab] = useState<"promote" | "mine">("promote");

  useEffect(() => {
    let alive = true;
    loadAffiliatesAction()
      .then((s) => alive && setState(s))
      .catch(() => {});
    if (window.location.search.includes("connect=")) window.history.replaceState(null, "", window.location.pathname === "/dashboard" ? "/dashboard?view=affiliates" : window.location.pathname);
    return () => {
      alive = false;
    };
  }, [business?.id]);

  return (
    <div className="min-h-screen px-4 md:px-10 py-6 md:py-10" style={{ background: "#F5F5F3" }}>
      <div className="max-w-[1080px] mx-auto flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h1 className="text-[24px] md:text-[28px] font-semibold text-pfg tracking-tight">{t.title}</h1>
            <a href={lang === "es" ? "/afiliados" : "/en/afiliados"} target="_blank" rel="noreferrer" className="text-[13px] text-psub hover:text-pfg underline underline-offset-4">
              {t.how} ↗
            </a>
          </div>
          <p className="text-[14.5px] text-psub max-w-[640px] leading-relaxed">{t.sub}</p>
        </div>

        <div className="inline-flex self-start rounded-full p-1" style={INSET} role="tablist">
          {(["promote", "mine"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className="h-9 px-4 rounded-full text-[13.5px] font-medium transition"
              style={tab === k ? { background: "#0A0A0A", color: "#fff" } : { color: "#27272A" }}
            >
              {k === "promote" ? t.tabPromote : t.tabMine}
            </button>
          ))}
        </div>

        {!state ? (
          <p className="text-[14px] text-pmuted">{t.loading}</p>
        ) : tab === "promote" ? (
          <Promote state={state} t={t} />
        ) : (
          <Mine state={state} setState={setState} t={t} onNavigate={(v) => (onNavigate ? onNavigate(v) : window.location.assign(`/dashboard?view=${v}`))} />
        )}
      </div>
    </div>
  );
}

type T = (typeof TEXT)["es"];

function Promote({ state, t }: { state: AffiliatesState; t: T }) {
  const e = state.earnings;
  const [copied, setCopied] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function connect() {
    setBusy(true);
    setErr("");
    try {
      const r = await affiliatePayoutAction(window.location.pathname === "/dashboard" ? "dashboard" : "panel");
      if (r.url) {
        window.location.href = r.url;
        return;
      }
      setErr(t.failed);
    } catch {
      setErr(t.failed);
    }
    setBusy(false);
  }
  async function copy(id: string, link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(id);
      setTimeout(() => setCopied(""), 1600);
    } catch {
      // the link stays visible to copy by hand
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          [t.pending, e.pendingCents, "#0A0A0A"],
          [t.held, e.heldCents, e.heldCents ? AMBER : "#0A0A0A"],
          [t.paid, e.paidCents, ACCENT],
        ].map(([label, cents, color]) => (
          <div key={label as string} className="rounded-[24px] p-4 flex flex-col gap-1" style={CARD}>
            <span className="text-[12.5px] text-pmuted">{label as string}</span>
            <span className="text-[24px] font-semibold tabular-nums" style={{ color: color as string }}>
              {usd(cents as number)}
            </span>
          </div>
        ))}
      </div>

      {state.paymentsOn ? (
        e.payout !== "ready" && (
          <div className="rounded-[24px] p-4 md:p-5 flex flex-col sm:flex-row sm:items-center gap-3 justify-between" style={{ ...CARD, boxShadow: `0 0 0 1px ${e.payout === "review" ? HAIR : "rgba(245,196,81,0.3)"}` }}>
            <div className="min-w-0">
              <div className="text-[15px] font-semibold text-pfg">{e.payout === "review" ? t.payoutReview : t.payoutTitle}</div>
              {e.payout !== "review" && <p className="text-[13.5px] text-psub mt-0.5 leading-relaxed max-w-[560px]">{t.payoutText}</p>}
              {err && <p className="text-[13px] text-red-600 mt-1">{err}</p>}
            </div>
            {e.payout !== "review" && (
              <button type="button" disabled={busy} onClick={connect} className="h-10 px-5 rounded-full text-[14px] font-semibold shrink-0 disabled:opacity-60 self-start sm:self-auto" style={BRAND_BTN}>
                {e.payout === "pending" ? t.payoutContinue : t.payoutBtn} →
              </button>
            )}
          </div>
        )
      ) : (
        <p className="text-[13.5px] text-psub">{t.payoutOff}</p>
      )}

      <div className="flex flex-col gap-1">
        <h2 className="text-[18px] font-semibold text-pfg">{t.servicesTitle}</h2>
        <p className="text-[13.5px] text-psub">{t.servicesSub}</p>
      </div>
      {state.promote.services.length === 0 ? (
        <p className="text-[14px] text-pmuted rounded-[24px] p-5" style={CARD}>
          {t.none}
        </p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {state.promote.services.map((s) => (
            <div key={s.id} className="rounded-[24px] p-4 md:p-5 flex flex-col gap-3 min-w-0" style={CARD}>
              <div className="flex items-start gap-3 min-w-0">
                {s.logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.logo} alt="" className="h-11 w-11 rounded-xl object-cover shrink-0" />
                ) : (
                  <span className="h-11 w-11 rounded-xl shrink-0 flex items-center justify-center font-semibold text-pfg" style={{ background: TINT }}>
                    {s.name.slice(0, 1).toUpperCase()}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-[15.5px] font-semibold text-pfg truncate">{s.name}</div>
                  {s.headline && <div className="text-[13px] text-psub leading-snug line-clamp-2">{s.headline}</div>}
                </div>
                <span className="text-[12.5px] font-semibold px-2.5 py-1 rounded-full shrink-0" style={{ background: TINT, color: ACCENT }}>
                  {t.commission(s.percent)}
                </span>
              </div>
              <div className="flex flex-wrap gap-2 text-[12px] text-pfg2">
                {s.agent && <span className="px-2.5 py-1 rounded-full" style={INSET}>{t.agent}</span>}
                {s.price && <span className="px-2.5 py-1 rounded-full" style={INSET}>{t.from(s.price)}</span>}
                <span className="px-2.5 py-1 rounded-full" style={INSET}>{t.visits(s.visits)}</span>
              </div>
              {s.pitch && (
                <p className="text-[13px] text-psub leading-relaxed">
                  <span className="text-pfg2">{t.ownerSays}:</span> {s.pitch}
                </p>
              )}
              <div className="flex items-center gap-2 min-w-0">
                <input readOnly value={s.link} onFocus={(ev) => ev.currentTarget.select()} className="flex-1 min-w-0 h-10 rounded-full px-4 text-[13px] text-pfg2 outline-none" style={INSET} />
                <button type="button" onClick={() => copy(s.id, s.link)} className="h-10 px-4 rounded-full text-[13px] font-semibold shrink-0" style={BRAND_BTN}>
                  {copied === s.id ? t.copied : t.copy}
                </button>
              </div>
              <a href={s.link} target="_blank" rel="noreferrer" className="text-[12.5px] text-pmuted hover:text-pfg self-start">
                {t.view} ↗
              </a>
            </div>
          ))}
        </div>
      )}

      <Sales title={t.mySales} empty={t.noSales} sales={e.sales} t={t} />
      <p className="text-[12.5px] text-pmuted leading-relaxed max-w-[760px]">{t.rules}</p>
    </div>
  );
}

function Mine({ state, setState, t, onNavigate }: { state: AffiliatesState; setState: (s: AffiliatesState) => void; t: T; onNavigate: (v: DashboardView) => void }) {
  const o = state.owner;
  const [form, setForm] = useState<AffiliateSettings | null>(o?.settings ?? null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  if (!o || !form) return <p className="text-[14px] text-pmuted">{t.nobusiness}</p>;
  const missing = [!o.published || !o.canPublish ? "publish" : "", !o.payReady ? "payments" : ""].filter(Boolean);
  // Until the page is published and Payments connected, nothing here can be used.
  const locked = missing.length > 0;

  async function save(next: AffiliateSettings) {
    setBusy(true);
    setMsg("");
    try {
      const r = await saveAffiliateSettingsAction(next);
      setForm(r.settings);
      if (r.ok && state.owner) setState({ ...state, owner: { ...state.owner, settings: r.settings } });
      setMsg(r.ok ? t.saved : t.failed);
    } catch {
      setMsg(t.failed);
    }
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-5">
      {missing.length > 0 && (
        <div className="rounded-[24px] p-4 md:p-5 flex flex-col gap-3" style={{ ...CARD, boxShadow: "0 0 0 1px rgba(245,196,81,0.3)" }}>
          <span className="text-[14.5px] font-semibold text-pfg">{t.needTitle}</span>
          {missing.includes("publish") && (
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <span className="text-[13.5px] text-pfg2">{o.canPublish ? t.needPublish : t.needPlan}</span>
              <button type="button" onClick={() => onNavigate(o.canPublish ? "store" : "plans")} className="h-9 px-4 rounded-full text-[13px]" style={GHOST}>
                {o.canPublish ? t.goStore : t.goPlans} →
              </button>
            </div>
          )}
          {missing.includes("payments") && (
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <span className="text-[13.5px] text-pfg2">{t.needPayments}</span>
              <button type="button" onClick={() => onNavigate("payments")} className="h-9 px-4 rounded-full text-[13px]" style={GHOST}>
                {t.goPayments} →
              </button>
            </div>
          )}
        </div>
      )}

      <fieldset disabled={locked} aria-disabled={locked} className={`rounded-[24px] p-4 md:p-6 flex flex-col gap-5 min-w-0 ${locked ? "opacity-60" : ""}`} style={CARD}>
        {locked && <p className="text-[13px] text-psub leading-relaxed">{t.lockedNote}</p>}
        <label className={`flex items-start justify-between gap-4 ${locked ? "cursor-not-allowed" : "cursor-pointer"}`}>
          <span className="min-w-0">
            <span className="block text-[16px] font-semibold text-pfg">{t.open(o.businessName)}</span>
            <span className="block text-[13.5px] text-psub mt-0.5 leading-relaxed max-w-[560px]">{t.openSub}</span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={form.enabled}
            disabled={busy || locked}
            onClick={() => save({ ...form, enabled: !form.enabled })}
            className="relative h-7 w-12 rounded-full shrink-0 transition disabled:opacity-60"
            style={{ background: form.enabled ? ACCENT : "rgba(10,10,10,0.136)" }}
          >
            <span className="absolute top-1 h-5 w-5 rounded-full bg-white transition-all" style={{ left: form.enabled ? 26 : 4 }} />
          </button>
        </label>

        <div className="flex flex-col gap-2">
          <span className="text-[13.5px] text-pfg font-medium">{t.percent}</span>
          <div className="flex items-center gap-4">
            <input
              type="range"
              min={AFF_MIN_PERCENT}
              max={AFF_MAX_PERCENT}
              step={1}
              value={form.percent}
              onChange={(e) => setForm({ ...form, percent: Number(e.target.value) })}
              className="flex-1 accent-[#16A34A]"
            />
            <span className="text-[22px] font-semibold text-pfg tabular-nums w-16 text-right">{form.percent}%</span>
          </div>
          <span className="text-[12.5px] text-pmuted leading-relaxed">{t.example(form.percent)}</span>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-[13.5px] text-pfg font-medium">{t.pitch}</span>
          <textarea
            rows={3}
            maxLength={600}
            value={form.pitch}
            onChange={(e) => setForm({ ...form, pitch: e.target.value })}
            placeholder={t.pitchPh(o.businessName)}
            className="rounded-xl px-4 py-3 text-[14px] text-pfg placeholder:text-pfaint outline-none resize-none"
            style={INSET}
          />
        </div>

        <div className="flex items-center gap-3">
          <button type="button" disabled={busy || locked} onClick={() => save(form)} className="h-10 px-5 rounded-full text-[14px] font-semibold disabled:opacity-60 disabled:cursor-not-allowed" style={BRAND_BTN}>
            {busy ? t.saving : t.save}
          </button>
          {msg && <span className="text-[13px]" style={{ color: msg === t.saved ? ACCENT : "#DC2626" }}>{msg}</span>}
        </div>
      </fieldset>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          [t.statAff, String(o.stats.affiliates)],
          [t.statVisits, String(o.stats.visits)],
          [t.statSales, `${o.stats.sales} · ${usd(o.stats.salesCents)}`],
          [t.statCom, usd(o.stats.commissionCents)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-[24px] p-4 flex flex-col gap-1" style={CARD}>
            <span className="text-[12.5px] text-pmuted">{k}</span>
            <span className="text-[18px] font-semibold text-pfg tabular-nums">{v}</span>
          </div>
        ))}
      </div>

      <Sales title={t.ownerSales} empty={t.ownerNoSales} sales={o.sales} t={t} />
    </div>
  );
}

function Sales({ title, empty, sales, t }: { title: string; empty: string; sales: AffSale[]; t: T }) {
  const lang = useLang();
  const day = (iso: string) => (iso ? new Date(iso).toLocaleDateString(lang === "es" ? "es-US" : "en-US", { month: "short", day: "numeric" }) : "");
  return (
    <div className="rounded-[24px] p-4 md:p-5 flex flex-col gap-3" style={CARD}>
      <span className="text-[15px] font-semibold text-pfg">{title}</span>
      {sales.length === 0 ? (
        <span className="text-[13.5px] text-pmuted">{empty}</span>
      ) : (
        <div className="flex flex-col">
          {sales.map((s, i) => (
            <div key={i} className="py-2.5 flex items-center justify-between gap-3 text-[13.5px]" style={i ? { borderTop: `1px solid ${HAIR}` } : undefined}>
              <span className="min-w-0">
                <span className="text-pfg">{s.title || s.business}</span>
                <span className="text-pmuted">
                  {s.business && s.title ? ` · ${s.business}` : ""} · {day(s.createdAt)} · {usd(s.amountCents)}
                </span>
              </span>
              <span className="text-right shrink-0">
                <span className="block font-semibold text-pfg tabular-nums">{usd(s.commissionCents)}</span>
                <span className="block text-[11.5px]" style={{ color: s.status === "paid" ? ACCENT : s.status === "void" ? "#DC2626" : s.status === "held" ? AMBER : "#71717A" }}>
                  {t.status[s.status] ?? s.status}
                  {s.status === "pending" ? ` ${t.payDay(day(s.payableAt))}` : ""}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
