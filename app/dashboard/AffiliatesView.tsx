"use client";

import SevriiLoader from "@/components/SevriiLoader";
import { useEffect, useState } from "react";
import { cachedView, loadView, putView } from "./viewCache";
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
    servicesSub: "Comparte tu link. La comisión es tuya si en los 30 días siguientes el cliente paga por Sevrii: en la página o con el link de pago que el dueño le manda por el chat, desde cualquier teléfono.",
    none: "Todavía no hay servicios abiertos a afiliados. Cuando un negocio abra el suyo para que otros lo vendan por comisión, aparecerá aquí con tu link. ¿Quieres que otros vendan el tuyo? Ábrelo en la pestaña de al lado.",
    zeroHint: "Aquí verás lo que ganas: cuando alguien compra con uno de tus links, la comisión aparece primero como pendiente y después como pagada en tu banco.",
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
    openSub: "Aparece en la lista de servicios para promocionar. Solo pagas cuando un afiliado te trae una venta. Si un cliente llega por un afiliado y te escribe, lo verás marcado en Conversaciones: cóbrale desde ahí con «Cobrar» y la comisión se calcula sola.",
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
    servicesSub: "Share your link. The commission is yours if within 30 days the customer pays through Sevrii: on the page or with the payment link the owner sends them in the chat, from any phone.",
    none: "No services are open to affiliates yet. When a business opens theirs for others to sell on commission, it shows up here with your link. Want others to sell yours? Open it in the next tab.",
    zeroHint: "This is where you'll see what you earn: when someone buys with one of your links, the commission shows as pending first and then as paid to your bank.",
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
    openSub: "It shows in the list of services to promote. You only pay when an affiliate brings you a sale. If a customer comes through an affiliate and writes to you, you'll see it marked in Conversations: charge them from there with «Charge» and the commission is worked out for you.",
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

// Two sides of Affiliates: in the dashboard, the owner's program (open their
// service so others sell it for a commission); in /panel-afiliado, the
// affiliate's side (promote services and get paid).
export default function AffiliatesView({ business, onNavigate, side }: { business: ClientBusiness | null; onNavigate?: (v: DashboardView) => void; side?: "owner" | "promoter" }) {
  const lang = useLang();
  const t = TEXT[lang];
  const o = OWNER_TEXT[lang];
  const ownerSide = (side ?? (onNavigate && business ? "owner" : "promoter")) === "owner";
  const cacheKey = `affiliates:${business?.id ?? "none"}`;
  const [state, setState] = useState<AffiliatesState | null>(() => cachedView<AffiliatesState>(cacheKey));
  useEffect(() => {
    if (state) putView(cacheKey, state);
  }, [state, cacheKey]);
  // First visit: the landing's green card with "Comenzar"; the program panel
  // shows after that (or right away once the program is on or has sales).
  const introKey = `aff-intro:${business?.id ?? "none"}`;
  const [started, setStarted] = useState(false);
  useEffect(() => {
    try {
      setStarted(Boolean(window.localStorage.getItem(introKey)));
    } catch {}
  }, [introKey]);
  const own = state?.owner;
  const showIntro = ownerSide && Boolean(own) && !started && !own?.settings.enabled && !own?.sales.length && !own?.stats.affiliates;

  useEffect(() => {
    let alive = true;
    loadView(`affiliates:${business?.id ?? "none"}`, loadAffiliatesAction)
      .then((s) => alive && setState(s))
      .catch(() => {});
    if (window.location.search.includes("connect=")) window.history.replaceState(null, "", window.location.pathname === "/dashboard" ? "/dashboard?view=affiliates" : window.location.pathname);
    return () => {
      alive = false;
    };
  }, [business?.id]);

  if (showIntro && own) {
    return (
      <div className="min-h-screen px-4 md:px-10 pb-6 md:pb-10 pearl-page pt-5 md:pt-10">
        <div className="max-w-[1180px] mx-auto flex flex-col gap-6">
          <AffIntro
            o={o}
            lang={lang}
            percent={own.settings.percent || 20}
            service={own.businessName}
            onStart={() => {
              try {
                window.localStorage.setItem(introKey, "1");
              } catch {}
              setStarted(true);
            }}
          />
          <a href="/panel-afiliado" className="self-start text-[13.5px] text-psub hover:text-pfg underline underline-offset-4">
            {o.toPromoter} →
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen px-4 md:px-10 pb-6 md:pb-10 ${ownerSide ? "pearl-page pt-5 md:pt-10" : ""}`}>
      <div className="max-w-[1080px] mx-auto flex flex-col gap-6">
        <div className={ownerSide ? "flex flex-col gap-2" : "dash-head dash-on-dark flex flex-col gap-2"}>
          {ownerSide && <span className="pearl-eyebrow">05 · {t.title}</span>}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h1 className={ownerSide ? "pearl-title" : "dash-title text-[24px] md:text-[28px] font-semibold text-pfg tracking-tight"}>{ownerSide ? o.ownerHeadline : o.promoterTitle}</h1>
            <a href={lang === "es" ? "/afiliados" : "/en/afiliados"} target="_blank" rel="noreferrer" className={ownerSide ? "pearl-btn" : "text-[13px] text-psub hover:text-pfg underline underline-offset-4"}>
              {t.how} ↗
            </a>
          </div>
          <p className="text-[14.5px] text-psub max-w-[640px] leading-relaxed">{ownerSide ? o.ownerSub : o.promoterSub}</p>
        </div>
        <div className={ownerSide ? "flex flex-col gap-6" : "dash-panel p-4 md:p-6 flex flex-col gap-6"}>
        {!state ? (
          <div className="flex justify-center"><SevriiLoader label={t.loading} /></div>
        ) : ownerSide ? (
          <Mine state={state} setState={setState} t={t} o={o} onNavigate={(v) => (onNavigate ? onNavigate(v) : window.location.assign(`/dashboard?view=${v}`))} />
        ) : (
          <Promote state={state} t={t} />
        )}
        </div>
        {ownerSide && (
          <a href="/panel-afiliado" className="self-start text-[13.5px] text-psub hover:text-pfg underline underline-offset-4">
            {o.toPromoter} →
          </a>
        )}
      </div>
    </div>
  );
}

type T = (typeof TEXT)["es"];

const AFF_PHOTO = "https://images.pexels.com/photos/7480527/pexels-photo-7480527.jpeg?auto=compress&cs=tinysrgb&w=1240";

// The landing's Afiliados section (sevrii.com/ofrecerservicios), as a card.
function AffIntro({ o, lang, percent, service, onStart }: { o: OT; lang: "es" | "en"; percent: number; service: string; onStart: () => void }) {
  const cut = Math.round(120 * percent) / 100;
  return (
    <div className="glow-card p-5 md:p-10 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-10 lg:gap-14 items-center">
      <div className="min-w-0 lg:order-2">
        <div className="glow-n mb-5">05 · {lang === "es" ? "Afiliados" : "Affiliates"}</div>
        <h1 className="glow-h mb-4">{o.ownerHeadline}</h1>
        <p className="glow-lead">{o.introLead}</p>
        <ul className="glow-points mt-8">
          {o.introPoints.map(([b, text]) => (
            <li key={b}>
              <b>{b}</b>
              <span>{text}</span>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-3 mt-8">
          <button type="button" onClick={onStart} className="glow-btn">
            {o.introStart}
          </button>
          <a href={lang === "es" ? "/afiliados" : "/en/afiliados"} target="_blank" rel="noreferrer" className="glow-ghost">
            {lang === "es" ? "Ver cómo funciona" : "See how it works"} ↗
          </a>
        </div>
      </div>
      <div className="soon-stage photo min-h-[420px] lg:min-h-[560px] lg:order-1 !items-start !justify-start" style={{ backgroundImage: `url(${AFF_PHOTO})` }} role="img" aria-label={o.introAlt}>
        <div className="soon-toast !absolute right-[8%] top-7">
          <b>✓</b>
          {o.introToast}
        </div>
        <div className="soon-card wide !absolute left-5 bottom-5 md:left-7 md:bottom-7">
          <div className="lbl">{o.introCard}</div>
          <div className="svc truncate">{service}</div>
          <div className="pct">
            <span>{o.introPct}</span>
            <b>{percent}%</b>
          </div>
          <div className="sale">
            <span>{o.introSale}</span>
            <strong>${cut % 1 ? cut.toFixed(2) : cut}</strong>
          </div>
          <div className="foot">{o.introFoot}</div>
        </div>
      </div>
    </div>
  );
}

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

      {!e.pendingCents && !e.heldCents && !e.paidCents && <p className="text-[13.5px] text-psub leading-relaxed max-w-[760px] -mt-2">{t.zeroHint}</p>}

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

function Mine({ state, setState, t, o: ot, onNavigate }: { state: AffiliatesState; setState: (s: AffiliatesState) => void; t: T; o: OT; onNavigate: (v: DashboardView) => void }) {
  const o = state.owner;
  const [form, setForm] = useState<AffiliateSettings | null>(o?.settings ?? null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [copied, setCopied] = useState(false);
  if (!o || !form) return <p className="text-[14px] text-pmuted">{t.nobusiness}</p>;
  const pageOk = o.published && o.canPublish;
  const payOk = o.payReady;
  // Until the page is published and Payments connected, the program can't run.
  const locked = !pageOk || !payOk;
  const on = Boolean(o.settings.enabled) && !locked;
  const invite = "https://www.sevrii.com/ser-afiliado";

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

  const Step = ({ done, n, title, text, action }: { done: boolean; n: number; title: string; text: string; action?: React.ReactNode }) => (
    <div className="flex items-start gap-3 py-3" style={n > 1 ? { borderTop: `1px solid ${HAIR}` } : undefined}>
      <span
        className="h-7 w-7 rounded-full shrink-0 flex items-center justify-center text-[12.5px] font-semibold"
        style={done ? { background: ACCENT, color: "#fff" } : { background: "rgba(10,10,10,0.07)", color: "#27272A" }}
      >
        {done ? "✓" : n}
      </span>
      <span className="min-w-0 grow">
        <span className="block text-[14.5px] font-medium text-pfg">{title}</span>
        <span className="block text-[13px] text-psub leading-relaxed">{text}</span>
      </span>
      {!done && action}
    </div>
  );

  return (
    <div className="flex flex-col gap-5">
      {/* The program: on or off, and what it still needs */}
      <div className="rounded-[24px] p-4 md:p-6 flex flex-col gap-4" style={CARD}>
        <div className="flex items-start justify-between gap-4">
          <span className="min-w-0">
            <span className="flex items-center gap-2 flex-wrap">
              <span className="text-[17px] font-semibold text-pfg">{ot.programTitle(o.businessName)}</span>
              <span
                className="text-[11.5px] font-semibold px-2.5 py-1 rounded-full"
                style={on ? { background: TINT, color: ACCENT } : locked ? { background: "rgba(245,158,11,0.12)", color: AMBER } : { background: "rgba(10,10,10,0.06)", color: "#52525B" }}
              >
                {on ? ot.statusOn : locked ? ot.statusLocked : ot.statusOff}
              </span>
            </span>
            <span className="block text-[13.5px] text-psub mt-1 leading-relaxed max-w-[620px]">{on ? ot.onText : ot.offText}</span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label={ot.toggle}
            disabled={busy || locked}
            onClick={() => save({ ...form, enabled: !form.enabled })}
            className="relative h-7 w-12 rounded-full shrink-0 transition disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: on ? ACCENT : "rgba(10,10,10,0.136)" }}
          >
            <span className="absolute top-1 h-5 w-5 rounded-full bg-white transition-all" style={{ left: on ? 26 : 4 }} />
          </button>
        </div>
        <div className="rounded-2xl px-4" style={INSET}>
          <Step
            n={1}
            done={pageOk}
            title={ot.stepPage}
            text={pageOk ? ot.stepPageOk : o.canPublish ? ot.stepPageTodo : ot.stepPlanTodo}
            action={
              <button type="button" onClick={() => onNavigate(o.canPublish ? "store" : "plans")} className="h-9 px-4 rounded-full text-[13px] shrink-0 self-center" style={GHOST}>
                {o.canPublish ? t.goStore : t.goPlans} →
              </button>
            }
          />
          <Step
            n={2}
            done={payOk}
            title={ot.stepPay}
            text={payOk ? ot.stepPayOk : ot.stepPayTodo}
            action={
              <button type="button" onClick={() => onNavigate("payments")} className="h-9 px-4 rounded-full text-[13px] shrink-0 self-center" style={GHOST}>
                {t.goPayments} →
              </button>
            }
          />
          <Step n={3} done={on} title={ot.stepOn} text={on ? ot.stepOnOk : ot.stepOnTodo} />
        </div>
      </div>

      {/* Commission and the note for affiliates */}
      <fieldset disabled={locked} aria-disabled={locked} className={`rounded-[24px] p-4 md:p-6 flex flex-col gap-5 min-w-0 ${locked ? "opacity-60" : ""}`} style={CARD}>
        <span className="text-[15px] font-semibold text-pfg">{ot.settingsTitle}</span>
        {locked && <p className="text-[13px] text-psub leading-relaxed -mt-3">{t.lockedNote}</p>}
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
          <span className="text-[12.5px] text-pmuted leading-relaxed -mt-1">{ot.pitchHelp}</span>
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

      {/* How it works for the owner */}
      <div className="rounded-[24px] p-4 md:p-6 flex flex-col gap-3" style={CARD}>
        <span className="text-[15px] font-semibold text-pfg">{ot.rulesTitle}</span>
        <ul className="flex flex-col gap-2.5">
          {ot.rules.map((r) => (
            <li key={r} className="flex gap-2.5 text-[13.5px] text-pfg2 leading-relaxed">
              <span className="shrink-0 mt-[1px]" style={{ color: ACCENT }}>✓</span>
              <span>{r}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Getting affiliates */}
      <div className="rounded-[24px] p-4 md:p-6 flex flex-col gap-3" style={CARD}>
        <span className="text-[15px] font-semibold text-pfg">{ot.inviteTitle}</span>
        <span className="text-[13.5px] text-psub leading-relaxed max-w-[700px]">{ot.inviteText}</span>
        <div className="flex gap-2 items-center flex-wrap">
          <input readOnly value={invite} onFocus={(e) => e.currentTarget.select()} className="flex-1 min-w-[220px] h-10 rounded-xl px-4 text-[13.5px] text-pfg outline-none" style={INSET} />
          <button
            type="button"
            onClick={() => {
              navigator.clipboard
                ?.writeText(invite)
                .then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1600);
                })
                .catch(() => {});
            }}
            className="h-10 px-4 rounded-full text-[13.5px] font-medium shrink-0"
            style={GHOST}
          >
            {copied ? t.copied : t.copy}
          </button>
        </div>
      </div>

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

const OWNER_TEXT = {
  es: {
    introLead: "Abre tu servicio a afiliados: creadores, promotores y clientes felices lo recomiendan con su link. Solo pagas comisión cuando alguien compra.",
    introPoints: [
      ["Tú pones la comisión", "Entre 5% y 50% de lo que paga el cliente."],
      ["Solo pagas por ventas", "Cuenta cuando el cliente paga por Sevrii: con un link de pago o el acceso a tu agente."],
      ["Sin sorpresas", "La comisión se paga a los 30 días, así los reembolsos no cuentan."],
    ] as [string, string][],
    introStart: "Comenzar",
    introToast: "Venta por afiliado",
    introCard: "Tu programa de afiliados",
    introPct: "Comisión",
    introSale: "Venta de $120 por @dani",
    introFoot: "Ejemplo ilustrativo · se paga a los 30 días",
    introAlt: "Creadora de contenido grabando con su teléfono",
    ownerHeadline: "Que otros vendan tu servicio por ti.",
    ownerSub: "Deja que otras personas vendan tu servicio por ti. Tú pones la comisión y solo pagas cuando un afiliado te trae una venta.",
    promoterTitle: "Gana como afiliado",
    promoterSub: "Recomienda servicios con tu link y gana la comisión que pone cada negocio por cada cliente que pague.",
    toPromoter: "¿También quieres ganar recomendando servicios de otros? Abre tu panel de afiliado",
    programTitle: (n: string) => `Programa de afiliados de ${n}`,
    statusOn: "Activo",
    statusOff: "Apagado",
    statusLocked: "Falta completar",
    toggle: "Activar o apagar el programa de afiliados",
    onText: "Tu servicio aparece en el panel de los afiliados con tu comisión. Cada venta que te traigan por Sevrii les paga su parte, sola.",
    offText: "Cuando lo actives, tu servicio aparece en el panel de los afiliados para que lo recomienden con su link.",
    stepPage: "Página publicada",
    stepPageOk: "Tu página está publicada.",
    stepPageTodo: "Publícala en Store: los afiliados mandan a sus clientes a tu página.",
    stepPlanTodo: "Publicar y tener afiliados vienen con el plan Starter.",
    stepPay: "Payments conectado",
    stepPayOk: "Tus clientes pueden pagarte por Sevrii.",
    stepPayTodo: "La comisión solo se puede calcular en pagos hechos por Sevrii: conecta Payments.",
    stepOn: "Programa activado",
    stepOnOk: "Los afiliados ya pueden recomendar tu servicio.",
    stepOnTodo: "Elige tu comisión, escribe tu mensaje y activa el programa con el interruptor de arriba.",
    settingsTitle: "Comisión y mensaje",
    pitchHelp: "Lo leen los afiliados antes de recomendarte: a quién le sirve tu servicio, qué decir y qué no prometer.",
    rulesTitle: "Cómo funciona para ti",
    rules: [
      "Solo pagas por ventas: cuando el cliente paga por Sevrii (un link de pago, el botón «Cobrar» de Conversaciones o el acceso a tu agente).",
      "Cada visita que llega por el link de un afiliado cuenta 30 días. Si ese cliente te escribe, lo verás marcado como «Afiliado» en Conversaciones.",
      "La comisión se descuenta del pago junto con el 5% de Payments, y Sevrii se la paga al afiliado 30 días después.",
      "Si reembolsas un pago o el cliente lo disputa, la comisión se anula.",
      "Puedes cambiar la comisión o apagar el programa cuando quieras; lo ya vendido se paga con la comisión de ese momento.",
    ],
    inviteTitle: "Consigue afiliados",
    inviteText: "Invita a clientes felices, creadores o promotores a recomendarte. Con este link crean su cuenta de afiliado gratis y, si tu programa está activo, ven tu servicio y su link para compartirlo.",
  },
  en: {
    introLead: "Open your service to affiliates: creators, promoters and happy customers recommend it with their link. You only pay commission when someone buys.",
    introPoints: [
      ["You set the commission", "Between 5% and 50% of what the customer pays."],
      ["You only pay for sales", "It counts when the customer pays through Sevrii: with a payment link or access to your agent."],
      ["No surprises", "The commission is paid after 30 days, so refunds don't count."],
    ] as [string, string][],
    introStart: "Get started",
    introToast: "Affiliate sale",
    introCard: "Your affiliate program",
    introPct: "Commission",
    introSale: "$120 sale by @dani",
    introFoot: "Illustrative example · paid after 30 days",
    introAlt: "Content creator recording with her phone",
    ownerHeadline: "Let others sell your service for you.",
    ownerSub: "Let other people sell your service for you. You set the commission and only pay when an affiliate brings you a sale.",
    promoterTitle: "Earn as an affiliate",
    promoterSub: "Recommend services with your link and earn the commission each business sets for every customer who pays.",
    toPromoter: "Want to earn by recommending other people's services too? Open your affiliate panel",
    programTitle: (n: string) => `${n} affiliate program`,
    statusOn: "On",
    statusOff: "Off",
    statusLocked: "Needs setup",
    toggle: "Turn the affiliate program on or off",
    onText: "Your service shows in affiliates' panel with your commission. Every sale they bring through Sevrii pays their share automatically.",
    offText: "Once you turn it on, your service shows in affiliates' panel so they can recommend it with their link.",
    stepPage: "Page published",
    stepPageOk: "Your page is published.",
    stepPageTodo: "Publish it in Store: affiliates send their customers to your page.",
    stepPlanTodo: "Publishing and affiliates come with the Starter plan.",
    stepPay: "Payments connected",
    stepPayOk: "Your customers can pay you through Sevrii.",
    stepPayTodo: "Commissions can only be worked out on payments made through Sevrii: connect Payments.",
    stepOn: "Program on",
    stepOnOk: "Affiliates can now recommend your service.",
    stepOnTodo: "Pick your commission, write your note and turn the program on with the switch above.",
    settingsTitle: "Commission and note",
    pitchHelp: "Affiliates read it before recommending you: who your service is for, what to say and what not to promise.",
    rulesTitle: "How it works for you",
    rules: [
      "You only pay for sales: when the customer pays through Sevrii (a payment link, the «Charge» button in Conversations or access to your agent).",
      "Each visit through an affiliate's link counts for 30 days. If that customer messages you, you'll see them marked «Affiliate» in Conversations.",
      "The commission is taken from the payment along with Payments' 5%, and Sevrii pays it to the affiliate 30 days later.",
      "If you refund a payment or the customer disputes it, the commission is voided.",
      "You can change the commission or turn the program off anytime; what's already sold is paid at the commission of that moment.",
    ],
    inviteTitle: "Get affiliates",
    inviteText: "Invite happy customers, creators or promoters to recommend you. With this link they create a free affiliate account and, if your program is on, they see your service and their link to share it.",
  },
};
type OT = (typeof OWNER_TEXT)["es"];

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

// Hovering "Afiliados" in the menu starts loading it.
export function warmAffiliates(businessId: string): void {
  if (!cachedView(`affiliates:${businessId}`)) loadView(`affiliates:${businessId}`, loadAffiliatesAction).catch(() => {});
}
