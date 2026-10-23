"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { getCampaignResultsAction } from "@/app/marketingResultsActions";
import { approveStrategyAction, getAgentStateAction } from "@/app/agentActions";
import type { CampaignStats } from "@/lib/db";
import type { AgentState } from "@/lib/agentTypes";
import CampaignResults from "./CampaignResults";
import AdImages from "./AdImages";
import MetaLaunch from "./MetaLaunch";
import MindMap, { type MindNode, type MindTone } from "./MindMap";
import { useLang } from "@/components/LangProvider";
import { MK_TEXT } from "@/lib/marketingI18n";
import { PLANS_TEXT } from "@/lib/plansI18n";
import { maxDailySpend, type CampaignSpec } from "@/lib/marketing";
import { activeOffer } from "@/lib/site";
import { sendMarketingChatAction } from "@/app/marketingActions";
import ChatPanel, { type Msg } from "./ChatPanel";
import ProjectDock, { Sheet, StepList, type StepItem } from "./ProjectDock";
import AgentPanel from "./AgentPanel";
import { toClientBusiness, type ClientBusiness, type ClientCampaign } from "./types";
import { ACCENT, BRAND_BTN, TINT } from "@/lib/brand";

type Lang = "es" | "en";
type Result = { link: string; stats: CampaignStats; week: CampaignStats };

const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const HAIR = "rgba(255,255,255,0.08)";
const RUNNING = ["live", "approved", "paused"];

// Marketing in 3 stages:
//  1. Estrategia — the chat (the strategist) builds the strategy and its
//     campaigns with the owner; they show up below as a mind map.
//  2. Aprobada — the owner approves it; the agent turns the campaigns into
//     launch proposals (one OK each) and prepares free posts.
//  3. En marcha — campaigns are out; the agent panel shows what it does.
export default function MarketingView({
  business,
  campaigns,
  initialMessages,
  greeting,
  onUpdated,
  onMessages,
  locked = false,
  onPlans,
}: {
  locked?: boolean;
  onPlans?: () => void;
  business: ClientBusiness;
  campaigns: ClientCampaign[];
  initialMessages: Msg[];
  greeting: string;
  onUpdated: (business: ClientBusiness, campaigns: ClientCampaign[]) => void;
  onMessages?: (m: Msg[]) => void;
}) {
  const lang = useLang();
  const t = MK_TEXT[lang];
  const m = t.map;
  const lk = PLANS_TEXT[lang].lock;
  const strategy = business.marketing.strategy;
  const approvedAt = business.marketing.approvedAt ?? null;
  const approved = Boolean(approvedAt);

  // What each campaign's link brought (visits, chats, contacts).
  const [results, setResults] = useState<Record<string, Result>>({});
  // The agent: undefined = loading, null = not available.
  const [agent, setAgent] = useState<AgentState | null | undefined>(undefined);
  const [approving, setApproving] = useState(false);
  const [approveErr, setApproveErr] = useState<string | null>(null);

  const campaignKey = campaigns.map((c) => `${c.id}:${c.status}`).join(",");
  useEffect(() => {
    if (locked) return;
    let alive = true;
    getCampaignResultsAction()
      .then((r) => {
        if (!alive || !r) return;
        setResults(Object.fromEntries(r.campaigns.map((c) => [c.id, { link: c.link, stats: c.stats, week: c.week }])));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [campaignKey, locked]);

  const loadAgent = useCallback(() => {
    getAgentStateAction()
      .then((s) => setAgent(s ?? null))
      .catch(() => setAgent(null));
  }, []);
  useEffect(() => {
    if (!locked) loadAgent();
  }, [locked, loadAgent]);

  if (locked) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "#000" }}>
        <div className="max-w-[520px] w-full rounded-2xl p-7 flex flex-col items-center text-center gap-4" style={{ background: "#111", boxShadow: "0 0 0 1px rgba(255,255,255,0.08)" }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={ACCENT} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="5" y="11" width="14" height="9" rx="2" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </svg>
          <h2 className="text-[22px] font-semibold text-white">{lk.marketingTitle}</h2>
          <p className="text-[14.5px] text-[#a1a1aa] leading-relaxed">{lk.marketingSub}</p>
          <button type="button" onClick={onPlans} className="h-11 px-6 rounded-full text-[14.5px] font-semibold" style={BRAND_BTN}>
            {lk.seePlans} →
          </button>
        </div>
      </div>
    );
  }

  const withSpec = campaigns.filter((c) => c.spec);
  const active = withSpec.filter((c) => c.status !== "declined");
  // Changed or new in the chat after approval: they wait for "Aprobar cambios".
  const changed = approved ? withSpec.filter((c) => c.status === "draft") : [];
  const running = withSpec.some((c) => RUNNING.includes(c.status));
  const step = !approved ? 0 : running ? 2 : 1;
  const showAgent = Boolean(agent && agent.allowed && (approved || agent.started));

  const applyUpdate = (res: Awaited<ReturnType<typeof sendMarketingChatAction>>) =>
    onUpdated(
      toClientBusiness(res.business),
      res.campaigns.map((c) => ({
        id: c.id,
        title: c.title,
        goal: c.goal,
        status: c.status,
        adCopy: c.adCopy,
        budgetNote: c.budgetNote,
        audience: c.audience,
        platforms: c.platforms,
        variations: c.variations,
        spec: c.spec ?? null,
      }))
    );
  // The agent changed the strategy or campaigns: reload them without sending
  // anything to the chat (an empty message only reads).
  const refresh = () =>
    sendMarketingChatAction("")
      .then(applyUpdate)
      .catch(() => {});

  const approve = async () => {
    if (approving) return;
    setApproving(true);
    setApproveErr(null);
    try {
      const res = await approveStrategyAction();
      if (!res.ok) {
        setApproveErr(res.error);
        return;
      }
      setAgent(res.state);
      await refresh();
      // What the agent put in motion opens from the chat.
      setRunningOpen(true);
    } catch {
      setApproveErr(m.failed);
    } finally {
      setApproving(false);
    }
  };

  const footer = (
    <CenterAction
      lang={lang}
      approving={approving}
      approved={approved}
      approvedAt={approvedAt}
      canApprove={Boolean(strategy) && active.length > 0}
      changed={changed.length}
      error={approveErr}
      onApprove={approve}
      agentAllowed={agent === undefined ? undefined : Boolean(agent?.allowed)}
      onPlans={onPlans}
    />
  );
  const nodes = buildNodes({ business, campaigns: withSpec, approved, agent: agent ?? null, results, lang });
  const hasMap = Boolean(strategy) || withSpec.length > 0;
  const profile = business.marketing.profile;
  const es = lang === "es";
  // Everything stays in the chat: the strategy is the last card of the
  // conversation, each part opens in place, and what's running opens from it.
  const plan = business.plan;
  const media: StepItem[] =
    plan.videoScript || plan.photoIdeas.length
      ? [
          {
            id: "media",
            label: es ? "Video y fotos" : "Video and photos",
            title: plan.videoScript ? (es ? "Guion de tu video listo" : "Your video script is ready") : es ? `${plan.photoIdeas.length} ideas de fotos` : `${plan.photoIdeas.length} photo ideas`,
            summary: es ? "Para tus anuncios y tu página. Pídeme cambios aquí." : "For your ads and your page. Ask me for changes here.",
            detail: (
              <div className="flex flex-col gap-4 min-w-0">
                {plan.videoScript && <p className="text-[14px] text-white leading-relaxed whitespace-pre-line rounded-xl p-4 break-words" style={{ background: "rgba(255,255,255,0.04)" }}>{plan.videoScript}</p>}
                {plan.photoIdeas.length > 0 && (
                  <ul className="flex flex-col gap-2">
                    {plan.photoIdeas.map((p, i) => (
                      <li key={i} className="text-[14px] text-[#ececec] leading-relaxed">
                        {i + 1}. {p}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ),
          },
        ]
      : [];
  const [runningOpen, setRunningOpen] = useState(false);
  const dock = hasMap ? (
    <ProjectDock
      eyebrow={es ? "Tu estrategia de marketing" : "Your marketing strategy"}
      title={profile.goal || m.goalFallback(profile.mainService || business.plan.service || "")}
      status={
        <span className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-[11.5px] font-medium" style={{ background: TINT, color: ACCENT }}>
          {t.flow.steps[step]}
        </span>
      }
    >
      {strategy?.summary && <p className="text-[13.5px] leading-relaxed text-[#d4d4d4]">{strategy.summary}</p>}
      <span className="text-[12.5px] text-[#8e8e8e]">{profile.monthlyBudgetUsd ? m.budgetMonth(usd(profile.monthlyBudgetUsd)) : m.noBudget}</span>
      {plan.guard.warn.length > 0 && (
        <div className="rounded-xl p-3 flex flex-col gap-1.5" style={{ background: "rgba(245,196,81,0.06)", boxShadow: "inset 0 0 0 1px rgba(245,196,81,0.22)" }}>
          <span className="text-[12px] font-semibold text-[#f5c451]">{es ? "Ten en cuenta" : "Keep in mind"}</span>
          {plan.guard.warn.map((x, i) => (
            <span key={i} className="text-[13px] text-[#f3e3b5] leading-relaxed">
              {x}
            </span>
          ))}
        </div>
      )}
      <StepList items={[...nodes, ...media]} />
      <div className="pt-1">{footer}</div>
      {approved && agent === undefined && <span className="text-[13px] text-[#a1a1a1]">{t.agent.loading}</span>}
      {showAgent && agent && (
        <button type="button" onClick={() => setRunningOpen(true)} className="self-start h-10 px-5 rounded-full text-[14px] font-semibold" style={BRAND_BTN}>
          {es ? "Ver lo que está en marcha" : "See what's running"}
        </button>
      )}
    </ProjectDock>
  ) : undefined;

  return (
    <div style={{ background: "#000" }} className="overflow-x-clip">
      {/* 1. The strategist: the chat comes first, full height */}
      <section className="h-[calc(100dvh-var(--hdr))] md:h-screen flex flex-col">
        <div className="shrink-0 h-12 md:h-14 px-4 md:px-6 flex items-center justify-between gap-3">
          <span className="min-w-0 truncate text-[16px] md:text-[17px] font-semibold text-white">
            {business.name} <span className="text-[#8e8e8e] font-normal">· {t.flow.title}</span>
          </span>
          <Stepper steps={t.flow.steps} current={step} />
        </div>
        <ChatPanel
          greeting={greeting}
          initialMessages={initialMessages}
          texts={{ ...t.chat, seeBelow: "", seeBelowHref: "" }}
          dock={dock}
          onSend={async (text) => {
            const res = await sendMarketingChatAction(text);
            onMessages?.(res.messages);
            applyUpdate(res);
            // The chat may have changed campaigns the agent was proposing.
            if (showAgent) loadAgent();
            return res.messages;
          }}
        />
      </section>

      {showAgent && agent && (
        <Sheet open={runningOpen} title={es ? "Lo que está en marcha" : "What's running"} onClose={() => setRunningOpen(false)} wide>
          <AgentPanel business={business} lang={lang} state={agent} setState={setAgent} onChanged={refresh} />
        </Sheet>
      )}
    </div>
  );
}

// ---------- header stepper ----------
function Check({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

// Estrategia — Aprobada — En marcha. The current step is the stage chip; on a
// phone the other steps are just numbered dots so it always fits one line.
function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex items-center gap-1 shrink-0" aria-label={steps.join(" · ")}>
      {steps.map((label, i) => (
        <li key={label} className="flex items-center gap-1" aria-current={i === current ? "step" : undefined}>
          {i > 0 && <span className="h-px w-2.5 sm:w-4" style={{ background: "rgba(255,255,255,0.14)" }} />}
          {i === current ? (
            <span className="h-6 px-2.5 rounded-full text-[11.5px] font-semibold flex items-center gap-1.5 whitespace-nowrap" style={{ background: TINT, color: ACCENT }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: ACCENT }} />
              {label}
            </span>
          ) : (
            <span className="h-6 flex items-center gap-1.5 text-[11.5px] whitespace-nowrap" style={{ color: i < current ? "#a1a1a1" : "#5c5c5c" }} title={label}>
              <span
                className="h-[18px] w-[18px] rounded-full flex items-center justify-center text-[10px] font-semibold"
                style={i < current ? { background: "rgba(125,191,156,0.16)", color: ACCENT } : { boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.16)" }}
              >
                {i < current ? <Check /> : i + 1}
              </span>
              <span className="hidden sm:inline">{label}</span>
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

// ---------- the main action in the center of the map ----------
function CenterAction({
  lang,
  approving,
  approved,
  approvedAt,
  canApprove,
  changed,
  error,
  onApprove,
  agentAllowed,
  onPlans,
}: {
  lang: Lang;
  agentAllowed?: boolean;
  onPlans?: () => void;
  approving: boolean;
  approved: boolean;
  approvedAt: string | null;
  canApprove: boolean;
  changed: number;
  error: string | null;
  onApprove: () => void;
}) {
  const m = MK_TEXT[lang].map;
  const btn = "w-full min-h-11 px-5 py-2.5 rounded-full text-[14px] font-semibold leading-snug disabled:opacity-60";
  const err = error && <span className="text-[12.5px] text-[#ff8a8a] leading-snug">{error}</span>;

  if (approving) {
    return (
      <div className="flex flex-col items-center gap-1.5" aria-live="polite">
        <span className="flex items-center gap-2 text-[13.5px] text-white">
          <span className="h-2 w-2 rounded-full animate-pulse" style={{ background: ACCENT }} />
          {m.approving}
        </span>
        <span className="text-[12px] text-[#8e8e8e]">{m.approvingSub}</span>
      </div>
    );
  }
  if (!approved) {
    if (!canApprove) return <span className="text-[12.5px] text-[#8e8e8e]">{m.building}</span>;
    // Still checking the plan: don't flash a button the owner may not have.
    if (agentAllowed === undefined) return <span className="h-11" aria-hidden="true" />;
    if (!agentAllowed) {
      return (
        <div className="w-full flex flex-col items-center gap-2">
          <span className="flex items-center gap-1.5 text-[13.5px] text-white font-medium leading-snug">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={ACCENT} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="5" y="11" width="14" height="9" rx="2" />
              <path d="M8 11V8a4 4 0 0 1 8 0v3" />
            </svg>
            {m.proTitle}
          </span>
          <span className="text-[12px] text-[#a1a1a1] leading-snug">{m.proSub}</span>
          {onPlans && (
            <button type="button" onClick={onPlans} className={btn} style={BRAND_BTN}>
              {m.proBtn} →
            </button>
          )}
        </div>
      );
    }
    return (
      <div className="w-full flex flex-col items-center gap-2">
        <button type="button" onClick={onApprove} className={btn} style={BRAND_BTN}>
          {m.approve}
        </button>
        <span className="text-[12px] text-[#a1a1a1] leading-snug">{m.approveHint}</span>
        {err}
      </div>
    );
  }
  if (changed > 0) {
    return (
      <div className="w-full flex flex-col items-center gap-2">
        <span className="text-[12.5px] text-[#f5c451] leading-snug">{m.changesHint(changed)}</span>
        <button type="button" onClick={onApprove} className={btn} style={BRAND_BTN}>
          {m.approveChanges}
        </button>
        {err}
      </div>
    );
  }
  const day = approvedAt ? new Date(approvedAt).toLocaleDateString(lang === "es" ? "es-US" : "en-US", { month: "long", day: "numeric" }) : "";
  return (
    <span className="h-7 px-3 rounded-full text-[12px] font-medium flex items-center gap-1.5" style={{ background: TINT, color: ACCENT }}>
      <Check size={11} />
      {m.approvedOn(day)}
    </span>
  );
}

function EmptyMap({ lang }: { lang: Lang }) {
  const m = MK_TEXT[lang].map;
  return (
    <div className="rounded-2xl px-5 py-8 md:py-10 flex flex-col items-center text-center gap-3" style={{ background: "#101010", boxShadow: `0 0 0 1px ${HAIR}` }}>
      <span className="text-[11px] font-semibold uppercase tracking-[0.1em]" style={{ color: ACCENT }}>
        {m.eyebrow}
      </span>
      <span className="text-[17px] font-semibold text-white">{m.emptyTitle}</span>
      <p className="text-[14px] text-[#a1a1a1] leading-relaxed max-w-[520px]">{m.emptyText}</p>
      <button
        type="button"
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        className="mt-1 h-10 px-5 rounded-full text-[13.5px] font-medium text-[#ececec] hover:text-white"
        style={{ background: "rgba(255,255,255,0.08)" }}
      >
        {m.toChat}
      </button>
    </div>
  );
}

// ---------- the branches of the map ----------
function buildNodes({
  business,
  campaigns,
  approved,
  agent,
  results,
  lang,
}: {
  business: ClientBusiness;
  campaigns: ClientCampaign[];
  approved: boolean;
  agent: AgentState | null;
  results: Record<string, Result>;
  lang: Lang;
}): MindNode[] {
  const t = MK_TEXT[lang];
  const m = t.map;
  const profile = business.marketing.profile;
  const strategy = business.marketing.strategy;
  const plan = business.plan;
  const site = business.site;
  const nodes: MindNode[] = [];
  const active = campaigns.filter((c) => c.status !== "declined");
  const first = (active[0] ?? campaigns[0])?.spec ?? null;

  // Público
  const custLang = profile.customerLanguage || plan.profile.languages || "";
  const langText = custLang ? m.langs[custLang] : first ? m.langs[first.language] : "";
  const whereText =
    site.reachMode === "remote"
      ? m.wholeUs
      : site.reachMode === "local"
        ? m.aroundCity(site.baseCity || profile.area || business.city || "", first?.radiusMiles || site.reachRadius)
        : profile.area || first?.city || business.city || "";
  const ageText = first ? t.ages(first.ageMin, first.ageMax) : "";
  const who = profile.idealCustomer || plan.customer || m.audienceFallback;
  nodes.push({
    id: "audience",
    label: m.audience,
    title: who,
    summary: [whereText, ageText, langText].filter(Boolean).join(" · "),
    detail: (
      <Rows
        rows={[
          [m.who, who],
          [m.where, whereText],
          [m.age, ageText],
          [m.lang, langText],
        ]}
      />
    ),
  });

  // Mensaje
  const offer = activeOffer(site);
  const offerText = offer ? [offer.label, offer.newPrice].filter(Boolean).join(" · ") : "";
  const stageMsg = strategy?.stages.find((s) => s.stage === "conversion")?.message || strategy?.stages[0]?.message || "";
  const promise = plan.promise || stageMsg;
  if (promise || offerText) {
    nodes.push({
      id: "message",
      label: m.message,
      title: promise || offerText,
      summary: offerText || m.noOffer,
      detail: (
        <Rows
          rows={[
            [m.promise, promise],
            [m.offer, offerText || m.noOffer],
            [m.why, plan.differentiators.filter(Boolean).join(" · ")],
          ]}
        />
      ),
    });
  }

  // One branch per funnel stage
  (strategy?.stages ?? []).forEach((s, i) => {
    nodes.push({
      id: `stage-${i}`,
      label: t.stages[s.stage],
      title: s.title,
      summary: s.channel,
      detail: (
        <Rows
          rows={[
            [m.channel, s.channel],
            [m.say, s.message],
            [m.doIt, s.action],
          ]}
        />
      ),
    });
  });

  // Presupuesto
  const max = profile.monthlyBudgetUsd;
  const monthly = Math.round(active.reduce((sum, c) => sum + (c.spec?.dailyBudgetUsd ?? 0) * 30, 0) * 100) / 100;
  const over = Boolean(max && monthly > max + 0.5);
  if (max || strategy?.budgetPlan || active.length) {
    nodes.push({
      id: "budget",
      label: m.budget,
      title: max ? m.budgetMonth(usd(max)) : m.noBudget,
      summary: strategy?.budgetPlan || undefined,
      tone: over ? "warn" : undefined,
      detail: (
        <div className="flex flex-col gap-3 text-[14px]">
          {strategy?.budgetPlan && <p className="text-[#d4d4d4] leading-relaxed">{strategy.budgetPlan}</p>}
          {active.length > 0 && (
            <ul className="flex flex-col rounded-xl overflow-hidden" style={{ background: "#171717" }}>
              {active.map((c, i) => (
                <li key={c.id} className="px-3.5 py-2.5 flex items-baseline justify-between gap-3" style={i > 0 ? { borderTop: `1px solid ${HAIR}` } : undefined}>
                  <span className="text-white min-w-0 truncate">{c.title}</span>
                  <span className="text-[#a1a1a1] text-[13px] whitespace-nowrap">{m.perDay(usd(c.spec!.dailyBudgetUsd), c.spec!.durationDays)}</span>
                </li>
              ))}
            </ul>
          )}
          {max && active.length > 0 && <p className="text-[13px] leading-relaxed" style={{ color: over ? "#f5c451" : "#a1a1a1" }}>{over ? m.overMonth(usd(monthly), usd(max)) : m.sumMonth(usd(monthly), usd(max))}</p>}
        </div>
      ),
    });
  }

  // Each campaign
  for (const c of campaigns) {
    const spec = c.spec as CampaignSpec;
    const n = spec.platform === "meta" ? spec.ads.length : spec.headlines.length;
    const tone: MindTone =
      c.status === "live" || c.status === "approved" ? "done" : c.status === "proposed" ? "active" : c.status === "draft" && approved ? "warn" : "idle";
    nodes.push({
      id: `c-${c.id}`,
      label: t.platform[spec.platform],
      title: c.title,
      summary: `${m.perDay(usd(spec.dailyBudgetUsd), spec.durationDays)}${spec.platform === "meta" && n ? ` · ${m.ads(n)}` : ""}`,
      badge: m.status[c.status] ?? m.status.draft,
      tone,
      detail: <CampaignDetail campaign={c} spec={spec} business={business} result={results[c.id]} approved={approved && Boolean(agent?.allowed)} />,
    });
  }

  // Publicaciones gratis
  const ready = (agent?.posts ?? []).filter((p) => p.status === "ready");
  if (ready.length > 0) {
    const channels = Array.from(new Set(ready.map((p) => t.agent.channels[p.channel])));
    nodes.push({
      id: "posts",
      label: m.posts,
      title: m.postsTitle(ready.length),
      summary: `${channels.join(" · ")} · ${m.postsSummary}`,
      tone: "done",
      detail: (
        <div className="flex flex-col gap-3">
          {ready.slice(0, 2).map((p) => (
            <div key={p.id} className="rounded-xl px-3.5 py-3" style={{ background: "#171717" }}>
              <div className="text-[11px] font-medium uppercase tracking-wider mb-1" style={{ color: ACCENT }}>
                {t.agent.channels[p.channel]}
              </div>
              <p className="text-[13.5px] text-[#d4d4d4] leading-relaxed line-clamp-3">{p.text}</p>
            </div>
          ))}
          <a href="#mk-posts" className="text-[13.5px] text-[#a1a1a1] hover:text-white underline underline-offset-4 decoration-[rgba(255,255,255,.25)] self-start">
            {m.postsSee}
          </a>
        </div>
      ),
    });
  }

  // Cómo medimos
  nodes.push({
    id: "measure",
    label: m.measure,
    title: m.measureTitle,
    summary: m.measureSummary,
    detail: (
      <div className="flex flex-col gap-2 text-[14px] text-[#d4d4d4] leading-relaxed">
        {m.measureText.map((p) => (
          <p key={p}>{p}</p>
        ))}
      </div>
    ),
  });

  return nodes;
}

function Rows({ rows }: { rows: [string, string][] }) {
  const list = rows.filter(([, v]) => v);
  if (list.length === 0) return null;
  return (
    <dl className="flex flex-col gap-3">
      {list.map(([k, v]) => (
        <div key={k} className="flex flex-col gap-0.5">
          <dt className="text-[11.5px] text-[#8e8e8e]">{k}</dt>
          <dd className="text-[14px] text-[#ececec] leading-relaxed">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function CopyButton({ text }: { text: string }) {
  const t = MK_TEXT[useLang()];
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="text-[12px] px-2.5 py-1 rounded-full text-[#d4d4d4] hover:text-white"
      style={{ background: "rgba(255,255,255,0.07)" }}
      onClick={() =>
        navigator.clipboard
          ?.writeText(text)
          .then(() => {
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          })
          .catch(() => {})
      }
    >
      {done ? t.copied : t.copy}
    </button>
  );
}

// Everything about one campaign, shown when its branch is opened.
function CampaignDetail({
  campaign,
  spec,
  business,
  result,
  approved,
}: {
  campaign: ClientCampaign;
  spec: CampaignSpec;
  business: ClientBusiness;
  result?: Result;
  approved: boolean;
}) {
  const lang = useLang();
  const t = MK_TEXT[lang];
  const photoCount = [business.site.coverUrl, ...business.site.gallery].filter(Boolean).length;
  const image = business.site.coverUrl || business.site.gallery[0] || "";
  const total = spec.dailyBudgetUsd * spec.durationDays;
  const cta = t.cta[spec.destination];
  const status = t.map.status[campaign.status] ?? t.map.status.draft;
  const live = RUNNING.includes(campaign.status);

  return (
    <div className="flex flex-col gap-5 min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        {campaign.goal && <span className="text-[13.5px] text-[#a1a1aa] leading-relaxed min-w-0 flex-1">{campaign.goal}</span>}
        <span className="text-[11.5px] px-2.5 py-1 rounded-full shrink-0" style={live ? { background: TINT, color: ACCENT } : { background: HAIR, color: "#d4d4d4" }}>
          {status}
        </span>
      </div>

      {/* Key facts */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 text-[13.5px]">
        <Fact k={t.platform[spec.platform]} v={t.objective[spec.objective]} />
        <Fact k={t.audience} v={`${t.area(spec.city, spec.radiusMiles)} · ${t.ages(spec.ageMin, spec.ageMax)} · ${t.language[spec.language]}`} />
        <Fact k={t.daily} v={`${usd(spec.dailyBudgetUsd)} × ${t.duration(spec.durationDays)}`} />
        <Fact k={t.total} v={usd(total)} />
      </div>
      {spec.platform === "meta" && <p className="text-[12.5px] text-[#8e8e8e] -mt-2 leading-relaxed">{t.maxDay(usd(maxDailySpend(spec.dailyBudgetUsd)))}</p>}

      {spec.specialCategory !== "none" && (
        <p className="text-[13px] rounded-xl px-3.5 py-2.5" style={{ background: "rgba(255,196,0,0.1)", color: "#ffd75e" }}>
          {t.special(t.specialNames[spec.specialCategory])}
        </p>
      )}

      {/* Ads: a swipeable row on phones, a grid on desktop */}
      {spec.platform === "meta" && spec.ads.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-[12px] text-[#8e8e8e]">
            {t.map.adTexts}
            {/* The ads are in the customers' language: say so when it isn't the panel's. */}
            {spec.language !== lang && (lang === "es" ? (spec.language === "en" ? " · en inglés, para tus clientes" : "") : spec.language === "es" ? " · in Spanish, for your customers" : "")}
          </span>
          <div className="-mx-4 px-4 flex gap-3 overflow-x-auto snap-x snap-mandatory scroll-px-4 no-scrollbar md:mx-0 md:px-0 md:grid md:grid-cols-2 lg:grid-cols-3 md:overflow-visible">
            {spec.ads.map((ad, i) => (
              <div key={i} className="w-[85%] shrink-0 snap-start md:w-auto flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-[#8e8e8e]">{t.variation(i + 1)}</span>
                  <CopyButton text={`${ad.primaryText}\n\n${ad.headline}${ad.description ? `\n${ad.description}` : ""}`} />
                </div>
                {/* Facebook/Instagram feed preview */}
                <div className="rounded-2xl overflow-hidden" style={{ background: "#fff", color: "#1c1e21" }}>
                  <div className="flex items-center gap-2.5 px-3 pt-3">
                    <span className="h-8 w-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0" style={{ background: business.accentColor === "#122118" ? "#234f36" : business.accentColor }}>
                      {business.name.slice(0, 2).toUpperCase()}
                    </span>
                    <div className="leading-tight min-w-0">
                      <div className="text-[13px] font-semibold truncate">{business.name}</div>
                      <div className="text-[11px] text-[#65676b]">{t.sponsored}</div>
                    </div>
                  </div>
                  <p className="px-3 py-2.5 text-[13.5px] leading-snug whitespace-pre-line break-words">{ad.primaryText}</p>
                  {image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={image} alt="" className="w-full aspect-[1.91/1] object-cover" />
                  ) : (
                    <div className="w-full aspect-[1.91/1] flex items-center justify-center text-white text-[15px] font-semibold px-6 text-center" style={{ background: "linear-gradient(135deg,#234f36,#0b1a12)" }}>
                      {business.site.headline || business.name}
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-3 px-3 py-2.5" style={{ background: "#f0f2f5" }}>
                    <div className="min-w-0">
                      <div className="text-[11px] text-[#65676b] uppercase truncate">sevrii.com</div>
                      <div className="text-[13.5px] font-semibold truncate">{ad.headline}</div>
                    </div>
                    <span className="shrink-0 text-[12.5px] font-semibold px-3 py-1.5 rounded-md" style={{ background: "#e4e6eb" }}>
                      {cta}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {spec.platform === "google" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-2xl p-4 flex flex-col gap-1 self-start min-w-0" style={{ background: "#fff", color: "#202124" }}>
            <span className="text-[12px] truncate">
              <b>{t.googleSponsored}</b> · sevrii.com/site/{business.slug}
            </span>
            <span className="text-[18px] leading-snug break-words" style={{ color: "#1a0dab" }}>
              {spec.headlines.slice(0, 3).join(" | ")}
            </span>
            <span className="text-[13.5px] text-[#4d5156]">{spec.descriptions.slice(0, 2).join(" ")}</span>
          </div>
          <div className="flex flex-col gap-3 text-[13.5px] min-w-0">
            <ListBlock title={t.headlines} items={spec.headlines} />
            <ListBlock title={t.descriptions} items={spec.descriptions} />
            <ListBlock title={t.keywords} items={spec.keywords} />
            {spec.negativeKeywords.length > 0 && <ListBlock title={t.negatives} items={spec.negativeKeywords} />}
          </div>
        </div>
      )}

      {result && <CampaignResults campaignId={campaign.id} link={result.link} stats={result.stats} week={result.week} lang={lang} />}
      {/* Publishing by hand only once the owner approved the strategy. */}
      {approved && campaign.status !== "declined" && <MetaLaunch campaign={{ id: campaign.id, platform: spec.platform }} lang={lang} />}
      {spec.platform === "meta" && <AdImages campaignId={campaign.id} photoCount={photoCount} lang={lang} />}

      {spec.notes && (
        <p className="text-[13.5px] text-[#d4d4d4] leading-relaxed">
          <span className="text-white font-medium">{t.note}:</span> {spec.notes}
        </p>
      )}

      <details className="group">
        <summary className="cursor-pointer list-none text-[13.5px] text-[#a1a1aa] hover:text-white">
          {t.howTo} <span className="inline-block transition group-open:rotate-90">›</span>
        </summary>
        <ol className="mt-3 flex flex-col gap-1.5 text-[13.5px] text-[#d4d4d4] list-decimal pl-5">
          {(spec.platform === "meta" ? t.metaSteps : t.googleSteps).map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      </details>
    </div>
  );
}

function Fact({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="rounded-xl px-3 py-2.5 min-w-0" style={{ background: "#171717" }}>
      <div className="text-[11.5px] text-[#8e8e8e] mb-0.5">{k}</div>
      <div className="text-white leading-snug break-words">{v}</div>
    </div>
  );
}

function ListBlock({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[12px] text-[#8e8e8e]">{title}</span>
        <CopyButton text={items.join("\n")} />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((x) => (
          <span key={x} className="text-[12.5px] px-2.5 py-1 rounded-full text-[#ececec]" style={{ background: "#1c1c1c" }}>
            {x}
          </span>
        ))}
      </div>
    </div>
  );
}
