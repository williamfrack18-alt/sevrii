"use client";

import { useState, useTransition } from "react";
import { useLang } from "@/components/LangProvider";
import { PLANS_TEXT } from "@/lib/plansI18n";
import { BILLINGS, PLANS, SAVINGS, STARTER_PRICES, priceFor, usd, type Billing, type ClientPlan, type PlanId } from "@/lib/plans";
import { checkCodeAction, openPortalAction, startCheckoutAction } from "@/app/billingActions";
import { ACCENT } from "@/lib/panel";

const GREEN = ACCENT;
const AMBER = "#ffc400";
// Only Free and Starter are shown; Starter is paid every 3, 6 or 12 months.
const SHOWN: PlanId[] = ["free", "starter"];

const PERIOD = {
  es: {
    quarter: ["Trimestral", "cada 3 meses"],
    semester: ["Semestral", "cada 6 meses"],
    year: ["Anual", "al año"],
    same: "Los tres incluyen lo mismo. Solo cambia cada cuánto pagas.",
    equals: (n: string) => `Equivale a ${n}/mes`,
    save: (n: number) => `Ahorras ${n} %`,
    pick: "Elegir",
    starterIncludes: "Starter incluye",
    code: "¿Tienes un código de descuento?",
    codePh: "Tu código",
    apply: "Aplicar",
    codeOk: (c: string) => `Código ${c} aplicado: ya ves el precio con descuento.`,
    codeBad: "Ese código no es válido.",
    codeRate: "Probaste muchos códigos. Intenta en un rato.",
    remove: "Quitar",
    best: "Mejor precio",
  },
  en: {
    quarter: ["Quarterly", "every 3 months"],
    semester: ["Half-yearly", "every 6 months"],
    year: ["Yearly", "per year"],
    same: "All three include the same. Only how often you pay changes.",
    equals: (n: string) => `Comes to ${n}/mo`,
    save: (n: number) => `Save ${n}%`,
    pick: "Choose",
    starterIncludes: "Starter includes",
    code: "Have a discount code?",
    codePh: "Your code",
    apply: "Apply",
    codeOk: (c: string) => `Code ${c} applied: you're seeing the discounted price.`,
    codeBad: "That code isn't valid.",
    codeRate: "Too many codes tried. Try again in a while.",
    remove: "Remove",
    best: "Best price",
  },
};


// Plans: start free, then pick the plan that includes the next step.
export default function PlansView({
  plan,
  notice,
}: {
  plan: ClientPlan;
  notice?: "success" | "cancel" | "projects" | "publish" | null;
}) {
  const lang = useLang();
  const t = PLANS_TEXT[lang];
  const pt = PERIOD[lang];
  const [billing, setBilling] = useState<Billing | null>(null);
  const [code, setCode] = useState("");
  const [applied, setApplied] = useState("");
  const [codeMsg, setCodeMsg] = useState<"" | "bad" | "rate">("");
  function applyCode() {
    const c = code.trim().toUpperCase();
    if (!c) return;
    setCodeMsg("");
    start(async () => {
      const r = await checkCodeAction(c);
      if (r.ok) setApplied(c);
      else setCodeMsg(r.error === "rate" ? "rate" : "bad");
    });
  }
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(lang === "es" ? "es-US" : "en-US", { day: "numeric", month: "long", year: "numeric" }) : "");

  function checkout(b: Billing) {
    setError("");
    setBilling(b);
    start(async () => {
      const r = await startCheckoutAction(b, applied);
      if (r.url) window.location.href = r.url;
      else setError(r.error === "not_ready" ? t.notReady : r.error === "already" ? t.already : t.failed);
    });
  }
  function portal() {
    setError("");
    start(async () => {
      const r = await openPortalAction();
      if (r.url) window.location.href = r.url;
      else setError(r.error === "not_ready" ? t.notReady : t.failed);
    });
  }

  const banner =
    notice === "success"
      ? { text: t.success, color: GREEN }
      : notice === "cancel"
        ? { text: t.cancel, color: "#52525B" }
        : notice === "projects"
          ? { text: t.needProjects(PLANS[plan.id].limits.projects), color: AMBER }
          : notice === "publish"
            ? { text: t.needPublish, color: AMBER }
            : null;

  const freeFeatures = t.highlights.free;
  const starterFeatures = t.highlights.starter;
  const cardBtn = (b: Billing, best: boolean) =>
    plan.id === "free" ? (
      <button type="button" disabled={pending} onClick={() => checkout(b)} className={`w-full h-12 text-[14.5px] font-semibold disabled:opacity-50 ${best ? "plans-btn white" : "plans-btn"}`}>
        {pending && billing === b ? "…" : `${pt.pick} ${pt[b][0].toLowerCase()}`}
      </button>
    ) : (
      <div className="h-12 flex items-center justify-center text-[13px] plans-muted rounded-full" style={{ background: "rgba(255,255,255,.05)" }}>
        {plan.id === "starter" ? t.current : t.higherPlan}
      </div>
    );

  return (
    <div className="plans-page min-h-[calc(100dvh-var(--hdr))] md:min-h-screen">
      <div className="max-w-[1200px] mx-auto px-4 md:px-10 pt-8 md:pt-16 pb-14 md:pb-24 flex flex-col gap-8 md:gap-10">
        {/* Title */}
        <header className="text-center flex flex-col items-center">
          <span className="plans-chip">{t.nav}</span>
          <h1 className="mt-4 text-[38px] md:text-[60px] leading-[1.03] font-light text-white" style={{ letterSpacing: "-1.8px" }}>{t.title}</h1>
          <p className="text-[15px] md:text-[17px] mt-4 max-w-[640px] leading-relaxed plans-soft">{t.sub}</p>
          <p className="text-[13px] mt-2 plans-muted">{pt.same}</p>
        </header>

        {(plan.admin || banner || plan.status === "past_due" || error) && (
          <div className="flex flex-col gap-2 max-w-[760px] w-full mx-auto">
            {plan.admin && <Banner text={t.admin} color={GREEN} />}
            {banner && <Banner text={banner.text} color={banner.color} />}
            {plan.status === "past_due" && <Banner text={t.pastDue} color={AMBER} />}
            {error && <Banner text={error} color="#DC2626" />}
          </div>
        )}

        {/* Already on Starter: when it renews, and the billing portal */}
        {plan.id === "starter" && (
          <div className="plans-glass mx-auto w-full max-w-[760px] px-5 py-4 flex flex-wrap items-center justify-between gap-3">
            <span className="text-[14px] text-white">
              <b className="font-semibold">{t.plans.starter.name}</b>
              {plan.renewsAt && <span className="plans-muted"> · {plan.cancelAtPeriodEnd ? t.ends(fmt(plan.renewsAt)) : t.renews(fmt(plan.renewsAt))}</span>}
            </span>
            {!plan.admin && (
              <button type="button" disabled={pending} onClick={portal} className="plans-ghost h-10 px-5 text-[14px]">
                {t.manage}
              </button>
            )}
          </div>
        )}

        {/* The four cards, side by side */}
        <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-stretch lg:pt-4 ${pending ? "opacity-70" : ""}`}>
          {/* Free */}
          <article className={`plans-card ${plan.id === "free" ? "current" : ""}`}>
            <div className="flex items-center justify-between gap-2 min-h-[26px]">
              <span className="text-[17px] font-semibold text-white">{t.plans.free.name}</span>
              {plan.id === "free" && <Pill text={t.current} />}
            </div>
            <div className="mt-5">
              <div className="h-[18px]" />
              <div className="flex items-baseline gap-1.5">
                <span className="text-[44px] leading-none font-semibold tracking-[-0.03em] text-white">$0</span>
              </div>
              <div className="text-[13px] mt-2 plans-muted">{t.plans.free.tagline}</div>
            </div>
            <p className="text-[13.5px] plans-soft leading-relaxed mt-5">{t.plans.free.summary}</p>
            <div className="plans-sep" />
            <ul className="flex flex-col gap-2.5 grow">
              {freeFeatures.map((h, i) => (
                <li key={i} className="flex gap-2.5 text-[13.5px] leading-snug text-white">
                  <Check />
                  {h}
                </li>
              ))}
            </ul>
            <div className="mt-6 h-12 flex items-center justify-center text-[13px] plans-muted rounded-full" style={{ background: "rgba(255,255,255,.05)" }}>
              {plan.id === "free" ? t.current : t.plans.free.tagline}
            </div>
          </article>

          {/* Starter, one card per way to pay */}
          {BILLINGS.map((b) => {
            const list = STARTER_PRICES[b];
            const pr = priceFor(b, Boolean(applied));
            const best = b === "year";
            return (
              <article key={b} className={`plans-card ${best ? "best" : ""}`}>
                {best && <span className="plans-ribbon">{pt.best}</span>}
                <div className="flex items-center justify-between gap-2 min-h-[26px]">
                  <span className="text-[17px] font-semibold text-white">{pt[b][0]}</span>
                  <span className={`plans-save ${best ? "hot" : ""}`}>{SAVINGS[b][lang]}</span>
                </div>
                <div className="mt-5">
                  <div className="h-[18px] text-[14px] line-through plans-muted">{applied ? usd(list.total) : ""}</div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-[44px] leading-none font-semibold tracking-[-0.03em] text-white">{usd(pr.total)}</span>
                    <span className="text-[13.5px] plans-muted">{pt[b][1]}</span>
                  </div>
                  <div className="text-[13px] mt-2" style={{ color: "#8ff0bb" }}>{pt.equals(usd(pr.perMonth))}</div>
                </div>
                <p className="text-[13.5px] plans-soft leading-relaxed mt-5">{t.plans.starter.summary}</p>
                <div className="plans-sep" />
                <ul className="flex flex-col gap-2.5 grow">
                  {starterFeatures.map((h, i) => (
                    <li key={i} className="flex gap-2.5 text-[13.5px] leading-snug text-white">
                      <Check />
                      {h}
                    </li>
                  ))}
                </ul>
                <div className="mt-6">{cardBtn(b, best)}</div>
              </article>
            );
          })}
        </div>

        {/* Discount code */}
        {plan.id === "free" && (
          <div className="flex justify-center">
            {applied ? (
              <div className="plans-glass px-5 py-3 flex flex-wrap items-center justify-center gap-3 text-[14px]" style={{ color: "#8ff0bb" }}>
                <span>✓ {pt.codeOk(applied)}</span>
                <button type="button" onClick={() => { setApplied(""); setCode(""); }} className="underline underline-offset-4 plans-muted">
                  {pt.remove}
                </button>
              </div>
            ) : (
              <form
                className="plans-glass px-4 py-3 flex flex-wrap items-center justify-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  applyCode();
                }}
              >
                <span className="text-[14px] plans-soft mx-1">{pt.code}</span>
                <input
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32));
                    setCodeMsg("");
                  }}
                  placeholder={pt.codePh}
                  autoCapitalize="characters"
                  className="plans-input w-[170px]"
                />
                <button type="submit" disabled={pending || !code.trim()} className="plans-btn white h-10 px-5 text-[13.5px] font-semibold disabled:opacity-50">
                  {pt.apply}
                </button>
                {codeMsg && <span className="w-full text-center text-[13px]" style={{ color: "#fca5a5" }}>{codeMsg === "rate" ? pt.codeRate : pt.codeBad}</span>}
              </form>
            )}
          </div>
        )}

        <div className="flex flex-col items-center gap-1.5 text-[13px] text-center plans-muted">
          <span>{t.adsNote}</span>
          <span>{t.capitalNote}</span>
        </div>

        {/* Compare */}
        <div className="flex flex-col gap-4">
          <h2 className="text-[24px] md:text-[28px] font-light text-white text-center" style={{ letterSpacing: "-0.5px" }}>{t.compareTitle}</h2>
          <div className="plans-glass overflow-x-auto">
            <table className="w-full min-w-[480px] text-[13.5px]">
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
                  <th className="text-left font-medium px-4 py-3 w-[38%]" />
                  {SHOWN.map((id) => (
                    <th key={id} className="text-center font-semibold px-3 py-3" style={{ color: plan.id === id ? "#5BE39A" : "#fff" }}>
                      {t.plans[id].name}
                      <div className="text-[12px] font-normal plans-muted">{id === "free" ? "$0" : `${usd(priceFor("quarter", Boolean(applied)).total)} – ${usd(priceFor("year", Boolean(applied)).total)}`}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {t.groups
                  .map((g) => ({ ...g, rows: g.rows.filter((r) => r.values.free !== false || r.values.starter !== false) }))
                  .filter((g) => g.rows.length > 0)
                  .map((g) => (
                    <GroupRows key={g.title} title={g.title} rows={g.rows} current={plan.id} />
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function GroupRows({ title, rows, current }: { title: string; rows: { label: string; values: Record<PlanId, boolean | string> }[]; current: PlanId }) {
  return (
    <>
      <tr>
        <td colSpan={3} className="px-4 pt-4 pb-1.5 text-[11px] font-semibold uppercase tracking-wider plans-muted">
          {title}
        </td>
      </tr>
      {rows.map((r) => (
        <tr key={r.label} style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <td className="px-4 py-2.5 plans-soft">{r.label}</td>
          {SHOWN.map((id) => {
            const v = r.values[id];
            return (
              <td key={id} className="text-center px-3 py-2.5" style={{ background: current === id ? "rgba(61,220,132,0.08)" : undefined }}>
                {v === true ? (
                  <span className="inline-flex justify-center">
                    <Check />
                  </span>
                ) : v === false ? (
                  <span className="plans-muted">—</span>
                ) : (
                  <span className="text-white">{v}</span>
                )}
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}

function Banner({ text, color }: { text: string; color: string }) {
  return (
    <div className="rounded-xl px-4 py-3 text-[14px]" style={{ background: "#FFFFFF", boxShadow: `0 0 0 1px ${color}55`, color: "#0A0A0A" }}>
      <span style={{ color }}>● </span>
      {text}
    </div>
  );
}

function Pill({ text }: { text: string }) {
  return (
    <span className="text-[11.5px] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap" style={{ background: "rgba(61,220,132,.16)", color: "#8ff0bb" }}>
      {text}
    </span>
  );
}

function Check() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#5BE39A" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="mt-[2px] shrink-0">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}
