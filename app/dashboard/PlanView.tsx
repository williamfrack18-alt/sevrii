"use client";

import { useLang } from "@/components/LangProvider";
import { PLAN_TEXT } from "@/lib/planI18n";
import { planProgress } from "@/lib/plan";
import { sendPlanChatAction } from "@/app/planActions";
import ChatPanel, { type Msg } from "./ChatPanel";
import { toClientBusiness, type ClientBusiness, type ClientService, type DashboardView } from "./types";

const GREEN = "#3ddc84";
const CARD = { background: "#111", boxShadow: "0 0 0 1px rgba(255,255,255,0.07)" } as const;

// Cerebro = the first step of every project. Same clean chat as Store and
// Marketing; the plan it builds (what to sell, to whom, how, at what price,
// which campaign) appears right below it.
export default function PlanView({
  business,
  initialMessages,
  greeting,
  onUpdated,
  onMessages,
  onNavigate,
}: {
  business: ClientBusiness;
  initialMessages: Msg[];
  greeting: string;
  onUpdated: (business: ClientBusiness, services: ClientService[]) => void;
  onMessages?: (m: Msg[]) => void;
  onNavigate: (view: DashboardView) => void;
}) {
  const t = PLAN_TEXT[useLang()];
  const plan = business.plan;
  const progress = planProgress(plan);
  const hasPlan = Boolean(plan.service || plan.packages.length || plan.customer);

  return (
    <div style={{ background: "#000" }}>
      <section className="h-[calc(100dvh-118px)] md:h-screen flex flex-col">
        <div className="shrink-0 h-14 px-4 md:px-6 flex items-center justify-between gap-3">
          <span className="text-[17px] font-semibold text-white truncate">
            Sevrii <span className="text-[#8e8e8e] font-normal">· {t.nav.plan}</span>
            <span className="text-[#52525b] font-normal hidden sm:inline"> · {business.name}</span>
          </span>
          {hasPlan && (
            <a
              href="#plan-result"
              className="text-[12px] px-3 py-1 rounded-full font-medium shrink-0"
              style={plan.ready ? { background: "rgba(61,220,132,.14)", color: GREEN } : { background: "rgba(255,255,255,.08)", color: "#d4d4d4" }}
            >
              {plan.ready ? t.approved : t.inProgress(progress)}
            </a>
          )}
        </div>
        <ChatPanel
          greeting={greeting}
          initialMessages={initialMessages}
          texts={{ ...t.chat, seeBelowHref: "#plan-result" }}
          onSend={async (text) => {
            const res = await sendPlanChatAction(text);
            onMessages?.(res.messages);
            onUpdated(
              toClientBusiness(res.business),
              res.services.map((s) => ({ id: s.id, name: s.name, price: s.price, description: s.description }))
            );
            return res.messages;
          }}
        />
      </section>

      <section id="plan-result" className="px-4 md:px-8 pt-8 pb-14" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
        <div className="max-w-[1100px] mx-auto flex flex-col gap-6">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-[20px] font-semibold text-white">{t.title}</h2>
            {hasPlan && (
              <div className="flex items-center gap-2.5 min-w-[180px]">
                <div className="h-1.5 w-32 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
                  <div className="h-full rounded-full" style={{ width: `${progress}%`, background: GREEN }} />
                </div>
                <span className="text-[12.5px] text-[#a1a1aa]">{plan.ready ? t.approved : t.inProgress(progress)}</span>
              </div>
            )}
          </div>

          {!hasPlan ? (
            <p className="text-[14.5px] text-[#8e8e8e]">{t.empty}</p>
          ) : (
            <>
              {/* The offer in one look */}
              <div className="rounded-2xl p-6 md:p-7 flex flex-col gap-5" style={CARD}>
                <div className="flex flex-col gap-1.5">
                  <Label>{t.service}</Label>
                  <div className="text-[22px] md:text-[26px] font-semibold text-white leading-tight">{plan.service || "—"}</div>
                  {plan.promise && <p className="text-[15.5px] text-[#d4d4d4] leading-relaxed max-w-[760px]">“{plan.promise}”</p>}
                </div>
                {(plan.customer || plan.problem) && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-5" style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
                    {plan.customer && (
                      <div className="flex flex-col gap-1.5">
                        <Label>{t.customer}</Label>
                        <p className="text-[14.5px] text-[#ececec] leading-relaxed">{plan.customer}</p>
                      </div>
                    )}
                    {plan.problem && (
                      <div className="flex flex-col gap-1.5">
                        <Label>{t.problem}</Label>
                        <p className="text-[14.5px] text-[#ececec] leading-relaxed">{plan.problem}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Packages and prices */}
              {plan.packages.length > 0 && (
                <div className="flex flex-col gap-3">
                  <Label>{t.packages}</Label>
                  <div className={`grid grid-cols-1 gap-3 ${plan.packages.length >= 3 ? "md:grid-cols-3" : plan.packages.length === 2 ? "md:grid-cols-2" : ""}`}>
                    {plan.packages.map((p, i) => (
                      <div key={i} className="rounded-2xl p-5 flex flex-col gap-2" style={CARD}>
                        <span className="text-[15px] font-semibold text-white">{p.name}</span>
                        <span className="text-[28px] font-semibold tracking-tight" style={{ color: GREEN }}>
                          {p.price || "—"}
                        </span>
                        {p.includes && <span className="text-[13.5px] text-[#d4d4d4] leading-relaxed">{p.includes}</span>}
                        {p.note && <span className="text-[12.5px] text-[#8e8e8e] leading-relaxed">{p.note}</span>}
                      </div>
                    ))}
                  </div>
                  {plan.pricingNote && (
                    <p className="text-[13px] text-[#8e8e8e] leading-relaxed">
                      <span className="text-[#d4d4d4] font-medium">{t.pricingNote}:</span> {plan.pricingNote}
                    </p>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {plan.differentiators.length > 0 && (
                  <div className="rounded-2xl p-5 flex flex-col gap-3" style={CARD}>
                    <Label>{t.differentiators}</Label>
                    <ul className="flex flex-col gap-2">
                      {plan.differentiators.map((d, i) => (
                        <li key={i} className="flex gap-2.5 text-[14px] text-[#ececec] leading-relaxed">
                          <Check />
                          {d}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {(plan.campaignType || plan.channels.length > 0) && (
                  <div className="rounded-2xl p-5 flex flex-col gap-3" style={CARD}>
                    <Label>{t.campaign}</Label>
                    {plan.campaignType && <p className="text-[15px] font-medium text-white leading-relaxed">{plan.campaignType}</p>}
                    {plan.channels.length > 0 && (
                      <ol className="flex flex-col gap-2">
                        {plan.channels.map((c, i) => (
                          <li key={i} className="text-[13.5px] text-[#a1a1aa] leading-relaxed">
                            <span className="text-[#ececec] font-medium">
                              {i + 1}. {c.channel}
                            </span>{" "}
                            — {c.why}
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                )}

                {plan.offer && (
                  <div className="rounded-2xl p-5 flex flex-col gap-1.5" style={{ ...CARD, boxShadow: "0 0 0 1px rgba(61,220,132,0.35)" }}>
                    <Label>{t.offer}</Label>
                    <span className="text-[16px] font-semibold text-white">{plan.offer.label}</span>
                    {plan.offer.detail && <span className="text-[13.5px] text-[#a1a1aa] leading-relaxed">{plan.offer.detail}</span>}
                  </div>
                )}

                {plan.requirements.length > 0 && (
                  <div className="rounded-2xl p-5 flex flex-col gap-3" style={{ background: "rgba(255,196,0,0.06)", boxShadow: "0 0 0 1px rgba(255,196,0,0.22)" }}>
                    <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "#ffc400" }}>
                      {t.requirements}
                    </span>
                    <ul className="flex flex-col gap-1.5">
                      {plan.requirements.map((r, i) => (
                        <li key={i} className="text-[13.5px] text-[#e4e4e7] leading-relaxed">
                          • {r}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {plan.nextSteps.length > 0 && (
                <div className="flex flex-col gap-2.5">
                  <Label>{t.nextSteps}</Label>
                  <ol className="flex flex-col gap-1.5">
                    {plan.nextSteps.map((s, i) => (
                      <li key={i} className="text-[14px] text-[#d4d4d4] leading-relaxed">
                        <span className="text-[#8e8e8e]">{i + 1}.</span> {s}
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              <div className="flex flex-wrap gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => onNavigate("store")}
                  className="h-11 px-5 rounded-full text-[14.5px] font-semibold"
                  style={{ background: GREEN, color: "#000" }}
                >
                  {t.goStore} →
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate("marketing")}
                  className="h-11 px-5 rounded-full text-[14.5px] font-medium text-white"
                  style={{ background: "rgba(255,255,255,0.08)" }}
                >
                  {t.goMarketing} →
                </button>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="text-[11px] font-semibold uppercase tracking-wider text-[#8e8e8e]">{children}</span>;
}

function Check() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="mt-[3px] shrink-0">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}
