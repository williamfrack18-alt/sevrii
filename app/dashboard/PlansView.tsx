"use client";

import { useState, useTransition } from "react";
import { useLang } from "@/components/LangProvider";
import { PLANS_TEXT } from "@/lib/plansI18n";
import { PLANS, PLAN_ORDER, type ClientPlan, type PlanId } from "@/lib/plans";
import { joinWaitlistAction, openPortalAction, startCheckoutAction } from "@/app/billingActions";
import { ACCENT, BRAND_BTN, RING } from "@/lib/brand";

const GREEN = ACCENT;
const AMBER = "#ffc400";

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
  const [yearly, setYearly] = useState(false);
  const [error, setError] = useState("");
  const [waitlist, setWaitlist] = useState<PlanId[]>(plan.waitlist);
  const [pending, start] = useTransition();
  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(lang === "es" ? "es-US" : "en-US", { day: "numeric", month: "long", year: "numeric" }) : "");

  function checkout() {
    setError("");
    start(async () => {
      const r = await startCheckoutAction(yearly ? "year" : "month");
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
  function notify(id: PlanId) {
    start(async () => {
      const r = await joinWaitlistAction(id);
      if (r.ok) setWaitlist((w) => [...new Set([...w, id])]);
    });
  }

  const banner =
    notice === "success"
      ? { text: t.success, color: GREEN }
      : notice === "cancel"
        ? { text: t.cancel, color: "#a1a1aa" }
        : notice === "projects"
          ? { text: t.needProjects(PLANS[plan.id].limits.projects), color: AMBER }
          : notice === "publish"
            ? { text: t.needPublish, color: AMBER }
            : null;

  return (
    <div className="min-h-screen" style={{ background: "#000" }}>
      <div className="h-14 px-4 md:px-6 flex items-center">
        <span className="text-[17px] font-semibold text-white">
          Sevrii <span className="text-[#8e8e8e] font-normal">· {t.nav}</span>
        </span>
      </div>

      <div className="max-w-[1180px] mx-auto px-4 md:px-8 pt-6 md:pt-10 pb-16 flex flex-col gap-8">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-5">
          <div>
            <h1 className="text-[28px] md:text-[34px] font-semibold text-white tracking-tight">{t.title}</h1>
            <p className="text-[15px] text-[#8e8e8e] mt-2 max-w-[620px] leading-relaxed">{t.sub}</p>
          </div>
          <div className="flex items-center gap-1 rounded-full p-1 self-start md:self-auto" style={{ background: "#141414", boxShadow: "0 0 0 1px rgba(255,255,255,0.08)" }}>
            {[false, true].map((y) => (
              <button
                key={String(y)}
                type="button"
                onClick={() => setYearly(y)}
                className="h-9 px-4 rounded-full text-[13.5px] font-medium"
                style={yearly === y ? { background: "#fff", color: "#000" } : { color: "#d4d4d4" }}
              >
                {y ? t.yearly : t.monthly}
                {y && <span className="ml-1.5 text-[11.5px]" style={{ color: yearly ? "#0f6e56" : GREEN }}>{t.yearlySave}</span>}
              </button>
            ))}
          </div>
        </div>

        {plan.admin && <Banner text={t.admin} color={GREEN} />}
        {banner && <Banner text={banner.text} color={banner.color} />}
        {plan.status === "past_due" && <Banner text={t.pastDue} color={AMBER} />}
        {error && <Banner text={error} color="#ff6b6b" />}

        <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-stretch ${pending ? "opacity-70" : ""}`}>
          {PLAN_ORDER.map((id) => {
            const def = PLANS[id];
            const p = t.plans[id];
            const isCurrent = plan.id === id;
            const price = yearly && def.yearlyPerMonth !== null ? def.yearlyPerMonth : def.monthly;
            const recommended = id === "starter" && plan.id === "free";
            return (
              <div
                key={id}
                className="rounded-2xl p-5 flex flex-col gap-4"
                style={{
                  background: "#111",
                  boxShadow: isCurrent ? `0 0 0 1.5px ${RING}` : recommended ? "0 0 0 1px rgba(255,255,255,0.35)" : "0 0 0 1px rgba(255,255,255,0.08)",
                }}
              >
                <div className="flex items-center justify-between gap-2 min-h-[24px]">
                  <span className="text-[16px] font-semibold text-white">{p.name}</span>
                  {isCurrent ? (
                    <Pill text={t.current} color={GREEN} />
                  ) : !def.available ? (
                    <Pill text={t.soon} color={AMBER} />
                  ) : null}
                </div>
                <div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-[34px] font-semibold text-white tracking-tight">{def.monthly === 0 ? "$0" : `$${price}`}</span>
                    {def.monthly > 0 && <span className="text-[13px] text-[#8e8e8e]">{t.perMonth}</span>}
                  </div>
                  <div className="text-[12.5px] text-[#8e8e8e] min-h-[18px]">
                    {def.monthly > 0 && yearly && def.yearlyPerMonth !== null ? t.billedYearly(def.yearlyPerMonth * 12) : p.tagline}
                  </div>
                </div>
                <p className="text-[13.5px] text-[#d4d4d4] leading-relaxed">{p.summary}</p>
                <ul className="flex flex-col gap-2 grow">
                  {t.highlights[id].map((h, i) => (
                    <li key={i} className="flex gap-2 text-[13.5px] leading-snug" style={{ color: i === 0 && id !== "free" ? "#8e8e8e" : "#ececec" }}>
                      <Check />
                      {h}
                    </li>
                  ))}
                </ul>
                <div className="pt-1">
                  {isCurrent ? (
                    id !== "free" && !plan.admin ? (
                      <button type="button" disabled={pending} onClick={portal} className="w-full h-11 rounded-full text-[14px] font-medium text-white" style={{ background: "rgba(255,255,255,0.08)" }}>
                        {t.manage}
                      </button>
                    ) : (
                      <div className="h-11 flex items-center justify-center text-[13px] text-[#8e8e8e]">
                        {plan.renewsAt && id !== "free" ? (plan.cancelAtPeriodEnd ? t.ends(fmt(plan.renewsAt)) : t.renews(fmt(plan.renewsAt))) : t.current}
                      </div>
                    )
                  ) : !def.available ? (
                    <button
                      type="button"
                      disabled={pending || waitlist.includes(id)}
                      onClick={() => notify(id)}
                      className="w-full h-11 rounded-full text-[14px] font-medium"
                      style={waitlist.includes(id) ? { background: "rgba(46,122,85,0.26)", color: GREEN } : { background: "rgba(255,255,255,0.08)", color: "#fff" }}
                    >
                      {waitlist.includes(id) ? `✓ ${t.notified}` : t.notify}
                    </button>
                  ) : id === "free" ? (
                    <div className="h-11" />
                  ) : (
                    <button
                      type="button"
                      disabled={pending || plan.id !== "free"}
                      onClick={checkout}
                      className="w-full h-11 rounded-full text-[14px] font-semibold disabled:opacity-40"
                      style={BRAND_BTN}
                    >
                      {t.choose(p.name)}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex flex-col gap-1.5 text-[13px] text-[#8e8e8e]">
          <span>• {t.adsNote}</span>
          <span>• {t.capitalNote}</span>
        </div>

        <div className="flex flex-col gap-3">
          <h2 className="text-[20px] font-semibold text-white">{t.compareTitle}</h2>
          <div className="rounded-2xl overflow-x-auto" style={{ background: "#111", boxShadow: "0 0 0 1px rgba(255,255,255,0.08)" }}>
            <table className="w-full min-w-[640px] text-[13.5px]">
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                  <th className="text-left font-medium text-[#8e8e8e] px-4 py-3 w-[38%]" />
                  {PLAN_ORDER.map((id) => (
                    <th key={id} className="text-center font-semibold px-3 py-3" style={{ color: plan.id === id ? GREEN : "#fff" }}>
                      {t.plans[id].name}
                      <div className="text-[12px] font-normal text-[#8e8e8e]">{PLANS[id].monthly ? `$${PLANS[id].monthly}${t.perMonth}` : "$0"}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {t.groups.map((g) => (
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
        <td colSpan={5} className="px-4 pt-4 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#8e8e8e]">
          {title}
        </td>
      </tr>
      {rows.map((r) => (
        <tr key={r.label} style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
          <td className="px-4 py-2.5 text-[#d4d4d4]">{r.label}</td>
          {PLAN_ORDER.map((id) => {
            const v = r.values[id];
            return (
              <td key={id} className="text-center px-3 py-2.5" style={{ background: current === id ? "rgba(46,122,85,0.11)" : undefined }}>
                {v === true ? (
                  <span className="inline-flex justify-center">
                    <Check />
                  </span>
                ) : v === false ? (
                  <span className="text-[#52525b]">—</span>
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
    <div className="rounded-xl px-4 py-3 text-[14px]" style={{ background: "#141414", boxShadow: `0 0 0 1px ${color}55`, color: "#ececec" }}>
      <span style={{ color }}>● </span>
      {text}
    </div>
  );
}

function Pill({ text, color }: { text: string; color: string }) {
  return (
    <span className="text-[11.5px] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap" style={{ background: `${color}22`, color }}>
      {text}
    </span>
  );
}

function Check() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="mt-[2px] shrink-0">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}
