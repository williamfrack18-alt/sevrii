"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useLang } from "@/components/LangProvider";
import { PLAN_TEXT } from "@/lib/planI18n";
import { APPROVAL_BLOCKS, type ApprovalBlock, type BusinessPlan, type PlanStage, type Profile } from "@/lib/plan";
import { approveBlockAction, chooseIdeaAction, finishPlanAction, moreIdeasAction, noOfferAction, sendPlanChatAction, type PlanChatResponse } from "@/app/planActions";
import { MAX_IDEA_ROUNDS } from "@/lib/plan";
import ChatPanel, { type Msg } from "./ChatPanel";
import MindMap, { type MindNode } from "./MindMap";
import { toClientBusiness, type ClientBusiness, type ClientService, type DashboardView } from "./types";
import { ACCENT, BRAND_BTN, RING } from "@/lib/brand";

const GREEN = ACCENT;
const AMBER = "#f5c451";
const RED = "#ff6b6b";
const HAIR = "rgba(255,255,255,0.08)";
const HAIR_STRONG = "rgba(255,255,255,0.14)";
const CARD = { background: "#101010", boxShadow: `0 0 0 1px ${HAIR}` } as const;
const INSET = { background: "rgba(255,255,255,0.04)", boxShadow: `inset 0 0 0 1px ${HAIR}` } as const;
const GHOST_BTN = { background: "rgba(255,255,255,0.06)", color: "#fff", boxShadow: `inset 0 0 0 1px ${HAIR}` } as const;
const PIPELINE: PlanStage[] = ["ideas_research", "research"];

type T = (typeof PLAN_TEXT)[keyof typeof PLAN_TEXT];
type Job = { kind: string; status: "queued" | "running" | "done" | "failed" };
type Snapshot = { plan: BusinessPlan | null; name: string; slug: string; jobs: Job[]; messages: Msg[]; more?: boolean; error?: string };

// Which approval block a guard note is about (the notes are free text).
const GUARD_HINTS: Record<ApprovalBlock, RegExp> = {
  service: /(licen[cs]i|seguro|insurance|revisi[oó]n de sevrii|sevrii review|alto riesgo|high[- ]risk|restringid|restricted)/i,
  pitch: /(promesa|promise|afirmaci|claim|garantiz|guarantee|el mejor|the best|rese[nñ]a|review|cifra|presenta)/i,
  packages: /(precio|price|paquete|package|tarifa|\$\s?\d)/i,
  offer: /(oferta|offer|promo|descuento|discount|fecha de fin|end date)/i,
  campaign: /(campa[nñ]a|campaign|anuncio|\bads?\b|\bmeta\b|urgencia|urgency|[uú]ltimos cupos|solo hoy)/i,
  faq: /(pregunta|\bfaq\b|question)/i,
};

const firstPending = (p: BusinessPlan): string | null => (p.stage === "approved" ? null : APPROVAL_BLOCKS.find((b) => !p.approvals[b]) ?? null);
const oneLine = (s: string, max = 110) => {
  const x = s.replace(/\s+/g, " ").trim();
  return x.length > max ? `${x.slice(0, max - 1).trimEnd()}…` : x;
};

// Cerebro = the first step of every project. The code moves the stages:
// interview → (ideas → pick → ready?) → research → proposal → approved.
// The chat is on top; the strategy grows below it as a mind map.
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
  onUpdated: (business: ClientBusiness, services?: ClientService[]) => void;
  onMessages?: (m: Msg[]) => void;
  onNavigate: (view: DashboardView) => void;
}) {
  const lang = useLang();
  const t = PLAN_TEXT[lang];
  const plan = business.plan;
  const isB = plan.mode === "new";
  const inPipeline = PIPELINE.includes(plan.stage);

  const [jobs, setJobs] = useState<Job[]>([]);
  const [pipeErr, setPipeErr] = useState<"" | "limit" | "failed">("");
  const [sync, setSync] = useState<{ key: number; messages: Msg[] }>();
  const [prefill, setPrefill] = useState<{ key: number; text: string }>();
  const [notice, setNotice] = useState("");
  const [busy, startAction] = useTransition();
  const [retryKey, setRetryKey] = useState(0);
  const [moreText, setMoreText] = useState("");
  // The open branch of the strategy map: the first block still to approve.
  // The detail panel opens when the owner taps a part (never by itself on load).
  const [openId, setOpenId] = useState<string | null>(null);

  // Latest values for the polling loop.
  const bizRef = useRef(business);
  bizRef.current = business;
  const msgCount = useRef(initialMessages.length);

  function apply(s: Snapshot) {
    if (s.plan) onUpdated({ ...bizRef.current, plan: s.plan, name: s.name || bizRef.current.name, slug: s.slug || bizRef.current.slug });
    if (s.jobs) setJobs(s.jobs);
    if (s.messages && s.messages.length !== msgCount.current) {
      msgCount.current = s.messages.length;
      setSync({ key: Date.now(), messages: s.messages });
      onMessages?.(s.messages);
    }
  }

  function applyAction(res: PlanChatResponse) {
    onUpdated(toClientBusiness(res.business), res.services.map((s) => ({ id: s.id, name: s.name, price: s.price, description: s.description })));
    msgCount.current = res.messages.length;
    setSync({ key: Date.now(), messages: res.messages });
    onMessages?.(res.messages);
    setNotice(res.notice ?? "");
  }

  // Drive the research pipeline one step per request while showing progress.
  useEffect(() => {
    if (!inPipeline) return;
    let stop = false;
    setPipeErr("");
    const poll = async () => {
      try {
        const r = await fetch("/api/brain", { cache: "no-store" });
        if (r.ok && !stop) apply((await r.json()) as Snapshot);
      } catch {}
    };
    const drive = async () => {
      for (let i = 0; i < 20 && !stop; i++) {
        let s: Snapshot;
        try {
          const r = await fetch(`/api/brain${i === 0 && retryKey ? "?retry=1" : ""}`, { method: "POST" });
          if (!r.ok) throw new Error(String(r.status));
          s = (await r.json()) as Snapshot;
        } catch {
          await new Promise((ok) => setTimeout(ok, 4000));
          continue;
        }
        if (stop) return;
        apply(s);
        if (s.error === "limit" || s.error === "failed") {
          setPipeErr(s.error);
          return;
        }
        if (s.error === "busy") await new Promise((ok) => setTimeout(ok, 5000));
        if (!s.more || (s.plan && !PIPELINE.includes(s.plan.stage))) return;
      }
      // Ran out of attempts while still researching: show the retry button instead of waiting forever.
      if (!stop) setPipeErr("failed");
    };
    poll();
    drive();
    const iv = setInterval(poll, 3000);
    return () => {
      stop = true;
      clearInterval(iv);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inPipeline, business.id, retryKey]);

  const stages = isB ? t.stagesB : t.stagesA;
  const order: PlanStage[] = isB
    ? ["interview", "ideas_research", "choose", "ready_check", "research", "proposal", "approved"]
    : ["interview", "research", "proposal", "approved"];
  const current = Math.max(0, order.indexOf(plan.stage));

  const act = (fn: () => Promise<PlanChatResponse>) => startAction(async () => applyAction(await fn()));
  // "Cambiar" closes the panel and writes the request in the chat.
  const change = (block: ApprovalBlock) => {
    setOpenId(null);
    setPrefill({ key: Date.now(), text: t.changePrefix(t.blocks[block]) });
  };
  // After approving, open the next block that still needs a look.
  const approve = (block: ApprovalBlock) =>
    startAction(async () => {
      const res = await approveBlockAction(block, true);
      applyAction(res);
      setOpenId(firstPending(toClientBusiness(res.business).plan));
    });

  const isStrategy = plan.stage === "proposal" || plan.stage === "approved";
  const doneCount = APPROVAL_BLOCKS.filter((b) => plan.approvals[b]).length;
  const allDone = doneCount === APPROVAL_BLOCKS.length;

  const chip =
    plan.stage === "approved" ? (
      <StatusChip tone="done">{stages[current]}</StatusChip>
    ) : inPipeline && !pipeErr ? (
      <StatusChip tone="live">{t.working}</StatusChip>
    ) : plan.stage === "proposal" ? (
      <StatusChip>{t.approvedShort(doneCount, APPROVAL_BLOCKS.length)}</StatusChip>
    ) : null;

  return (
    <div className="overflow-x-clip" style={{ background: "#000" }}>
      <section className="h-[calc(100dvh-var(--hdr))] md:h-screen flex flex-col">
        <div className="shrink-0 px-4 md:px-6 pt-2.5 md:pt-3 pb-2.5 flex flex-col gap-2" style={{ borderBottom: `1px solid ${HAIR}` }}>
          <div className="flex items-center justify-between gap-3 min-w-0">
            <span className="text-[16px] md:text-[17px] font-semibold text-white truncate min-w-0">
              <span className="hidden md:inline">
                Sevrii <span className="text-[#8e8e8e] font-normal">· </span>
              </span>
              {t.nav.plan}
              <span className="text-[#52525b] font-normal hidden lg:inline"> · {business.name}</span>
            </span>
            {chip}
          </div>
          <StageBar labels={stages} current={current} />
          <StageSteps labels={stages} current={current} t={t} />
        </div>
        <ChatPanel
          greeting={greeting}
          initialMessages={initialMessages}
          texts={{
            ...t.chat,
            emptyTitle: isB ? t.chat.emptyTitleB : t.chat.emptyTitleA,
            emptySub: isB ? t.chat.emptySubB : t.chat.emptySubA,
            seeBelowHref: "#plan-result",
          }}
          locked={
            inPipeline && !pipeErr ? (
              <div className="flex flex-col gap-2.5 w-full">
                <span>{plan.stage === "ideas_research" ? t.lockedIdeas : t.locked}</span>
                <Progress jobs={jobs} plan={plan} compact />
              </div>
            ) : undefined
          }
          sync={sync}
          prefill={prefill}
          onSend={async (text) => {
            const res = await sendPlanChatAction(text);
            onUpdated(toClientBusiness(res.business), res.services.map((s) => ({ id: s.id, name: s.name, price: s.price, description: s.description })));
            msgCount.current = res.messages.length;
            onMessages?.(res.messages);
            return res.messages;
          }}
        />
      </section>

      <section id="plan-result" className="px-4 md:px-8 pt-8 md:pt-10 pb-14" style={{ borderTop: `1px solid ${HAIR}` }}>
        <div className={`max-w-[1100px] mx-auto flex flex-col gap-5 min-w-0 transition-opacity ${busy ? "opacity-70" : ""}`}>
          {notice && (
            <p className="text-[13.5px] leading-relaxed rounded-xl px-4 py-3" style={{ background: "rgba(245,196,81,0.06)", boxShadow: "inset 0 0 0 1px rgba(245,196,81,0.22)", color: "#f3e3b5" }}>
              {notice}
            </p>
          )}

          {pipeErr && (
            <div className="rounded-2xl p-4 md:p-5 flex items-center justify-between gap-4 flex-wrap" style={CARD}>
              <span className="text-[14px] leading-relaxed min-w-0" style={{ color: pipeErr === "limit" ? AMBER : RED }}>
                {pipeErr === "limit" ? t.limit : t.failed}
              </span>
              {pipeErr === "limit" && (
                <button type="button" onClick={() => onNavigate("plans")} className="h-10 px-5 rounded-full text-[14px] font-semibold shrink-0" style={BRAND_BTN}>
                  {t.seePlans}
                </button>
              )}
              {pipeErr === "failed" && (
                <button type="button" onClick={() => setRetryKey((k) => k + 1)} className="h-10 px-5 rounded-full text-[14px] font-semibold shrink-0" style={BRAND_BTN}>
                  {t.retry}
                </button>
              )}
            </div>
          )}

          {(plan.stage === "interview" || plan.stage === "ready_check") && <ProfileCard plan={plan} />}

          {plan.stage === "choose" && (
            <div className="flex flex-col gap-4">
              <SectionHead title={t.ideasTitle} sub={t.ideasSub} />
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                {plan.ideas.map((idea, i) => (
                  <div key={i} className="rounded-2xl p-5 flex flex-col gap-3 min-w-0" style={i === 0 ? { ...CARD, boxShadow: `0 0 0 1px ${RING}` } : CARD}>
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-[17px] font-semibold text-white leading-snug min-w-0 break-words">{idea.title}</span>
                      <span className="text-[12px] px-2 py-0.5 rounded-full shrink-0 font-medium" style={{ background: "rgba(46,122,85,0.26)", color: GREEN }}>
                        {t.fit(idea.score)}
                      </span>
                    </div>
                    <p className="text-[13.5px] text-[#d4d4d4] leading-relaxed">{idea.why}</p>
                    <Facts
                      rows={[
                        [t.typicalPrice, idea.typicalPrice],
                        [t.startCost, idea.startCost],
                        [t.license, idea.license && !/^no\b/i.test(idea.license.trim()) ? idea.license : ""],
                        [t.demand, idea.demand],
                      ]}
                    />
                    {(idea.pros || idea.cons) && (
                      <div className="flex flex-col gap-1.5 pt-3" style={{ borderTop: `1px solid ${HAIR}` }}>
                        {idea.pros && (
                          <p className="text-[13px] text-[#a1a1a1] leading-relaxed flex gap-2">
                            <span className="shrink-0 font-semibold" style={{ color: GREEN }}>+</span>
                            <span className="min-w-0">{idea.pros}</span>
                          </p>
                        )}
                        {idea.cons && (
                          <p className="text-[13px] text-[#a1a1a1] leading-relaxed flex gap-2">
                            <span className="shrink-0 font-semibold" style={{ color: AMBER }}>−</span>
                            <span className="min-w-0">{idea.cons}</span>
                          </p>
                        )}
                      </div>
                    )}
                    <Sources list={idea.sources} />
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => act(() => chooseIdeaAction(i))}
                      className="mt-auto h-11 rounded-full text-[14px] font-semibold disabled:opacity-60"
                      style={i === 0 ? BRAND_BTN : GHOST_BTN}
                    >
                      {t.choose}
                    </button>
                  </div>
                ))}
              </div>
              <div className="rounded-2xl p-5 flex flex-col gap-3" style={CARD}>
                <div>
                  <div className="text-[16px] font-semibold text-white">{t.moreTitle}</div>
                  <p className="text-[13.5px] text-[#a1a1a1] mt-0.5 leading-relaxed">{plan.ideaRounds >= MAX_IDEA_ROUNDS ? t.moreNoLeft : t.moreSub}</p>
                </div>
                {plan.ideaRounds < MAX_IDEA_ROUNDS && (
                  <form
                    className="flex flex-col sm:flex-row gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const text = moreText;
                      act(async () => {
                        const res = await moreIdeasAction(text);
                        setMoreText("");
                        return res;
                      });
                    }}
                  >
                    <input
                      id="more-ideas"
                      value={moreText}
                      onChange={(e) => setMoreText(e.target.value)}
                      maxLength={300}
                      placeholder={t.morePlaceholder}
                      className="flex-1 min-w-0 h-11 rounded-full px-4 text-[14px] text-white placeholder:text-[#6b6b6b] outline-none focus:ring-2"
                      style={{ background: "rgba(255,255,255,0.06)", boxShadow: `0 0 0 1px ${HAIR_STRONG}` }}
                    />
                    <button type="submit" disabled={busy} className="h-11 px-5 rounded-full text-[14px] font-semibold shrink-0 disabled:opacity-60" style={BRAND_BTN}>
                      {busy ? t.moreBusy : t.moreButton}
                    </button>
                  </form>
                )}
              </div>
            </div>
          )}

          {isStrategy && (
            <div className="flex flex-col gap-5">
              <SectionHead title={plan.stage === "approved" ? t.approvedTitle : t.proposalTitle} sub={plan.stage === "approved" ? t.approvedSub : t.proposalMapSub} />
              {plan.guard.block.length > 0 && <Notes title={t.guardBlock} items={plan.guard.block} color={RED} />}
              {plan.stage === "proposal" && allDone && (
                <div className="rounded-2xl p-4 md:p-5 flex items-center justify-between gap-4 flex-wrap" style={{ ...CARD, boxShadow: `0 0 0 1px ${RING}` }}>
                  <div className="min-w-0">
                    <div className="text-[15px] font-semibold text-white">{t.finishTitle}</div>
                    <p className="text-[13px] text-[#a1a1a1] mt-0.5 max-w-[560px] leading-relaxed">{t.finishSub}</p>
                  </div>
                  <button type="button" disabled={busy} onClick={() => act(() => finishPlanAction())} className="h-10 px-5 rounded-full text-[14px] font-semibold shrink-0 disabled:opacity-60" style={BRAND_BTN}>
                    {t.finishButton}
                  </button>
                </div>
              )}
              {plan.guard.warn.length > 0 && <Notes title={t.guardWarn} items={plan.guard.warn} color={AMBER} />}

              <div className="pt-1 md:pt-3">
                <MindMap
                  center={{
                    eyebrow: t.strategyEyebrow,
                    title: plan.service || business.name,
                    subtitle: oneLine(plan.customer || plan.promise) || undefined,
                    footer: <CenterFooter plan={plan} done={doneCount} t={t} />,
                  }}
                  groups={lang === "es"
                    ? [
                        { id: "sell", label: "Lo que vendes" },
                        { id: "how", label: "Cómo lo vendes" },
                        { id: "market", label: "Tu mercado" },
                      ]
                    : [
                        { id: "sell", label: "What you sell" },
                        { id: "how", label: "How you sell it" },
                        { id: "market", label: "Your market" },
                      ]}
                  nodes={strategyNodes({ plan, t, busy, onApprove: approve, onChange: change, onNoOffer: () => act(() => noOfferAction()) }).map((n) => ({
                    ...n,
                    group: ["service", "packages", "offer"].includes(n.id) ? "sell" : ["zone", "requirements"].includes(n.id) ? "market" : "how",
                  }))}
                  openId={openId}
                  onOpenChange={setOpenId}
                />
              </div>

              {plan.stage === "approved" && (
                <div className="flex flex-col sm:flex-row gap-3 pt-2">
                  <button type="button" onClick={() => onNavigate("store")} className="h-11 px-5 rounded-full text-[14.5px] font-semibold" style={BRAND_BTN}>
                    {t.goStore} →
                  </button>
                  <button type="button" onClick={() => onNavigate("marketing")} className="h-11 px-5 rounded-full text-[14.5px] font-medium" style={GHOST_BTN}>
                    {t.goMarketing} →
                  </button>
                </div>
              )}
            </div>
          )}

          {!isStrategy && plan.market.researchedAt && <MarketCard plan={plan} />}
        </div>
      </section>
    </div>
  );
}

// ---------- strategy map ----------

function strategyNodes({
  plan,
  t,
  busy,
  onApprove,
  onChange,
  onNoOffer,
}: {
  plan: BusinessPlan;
  t: T;
  busy: boolean;
  onApprove: (b: ApprovalBlock) => void;
  onChange: (b: ApprovalBlock) => void;
  onNoOffer: () => void;
}): MindNode[] {
  const offerOk = !plan.offer || Boolean(plan.offer.endsAt) || plan.offer.forNewClients;
  const flagged = (b: ApprovalBlock) =>
    plan.stage === "proposal" && (plan.guard.block.some((n) => GUARD_HINTS[b].test(n)) || (b === "offer" && !offerOk));
  const status = (b: ApprovalBlock): Pick<MindNode, "tone" | "badge"> => {
    const ok = plan.approvals[b] === true;
    return { tone: ok ? "done" : flagged(b) ? "warn" : "idle", badge: ok ? t.approved : t.toApprove };
  };
  const detail = (b: ApprovalBlock, body: ReactNode, opts: { canApprove?: boolean; extra?: ReactNode } = {}) => (
    <BlockDetail id={b} plan={plan} busy={busy} onApprove={onApprove} onChange={onChange} canApprove={opts.canApprove} extra={opts.extra}>
      {body}
    </BlockDetail>
  );

  const nodes: MindNode[] = [];

  // Tu servicio
  nodes.push({
    id: "service",
    label: t.blocks.service,
    title: plan.serviceIncludes || plan.service,
    summary: plan.problem || undefined,
    ...status("service"),
    detail: detail(
      "service",
      <>
        <Facts
          rows={[
            [t.includes, plan.serviceIncludes],
            [t.excludes, plan.serviceExcludes],
            [t.customer, plan.customer],
            [t.problem, plan.problem],
          ]}
        />
        {plan.steps.length > 0 && (
          <div className="flex flex-col gap-2">
            <Label>{t.steps}</Label>
            <ol className="flex flex-col gap-2">
              {plan.steps.map((s, i) => (
                <li key={i} className="flex gap-3 text-[13.5px] text-[#ececec] leading-relaxed">
                  <span className="h-5 w-5 rounded-full shrink-0 flex items-center justify-center text-[11px] font-semibold mt-px" style={{ background: "rgba(255,255,255,0.06)", color: "#a1a1a1" }}>
                    {i + 1}
                  </span>
                  <span className="min-w-0">{s}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </>
    ),
  });

  // Cómo te presentas
  nodes.push({
    id: "pitch",
    label: t.blocks.pitch,
    title: plan.promise ? `“${plan.promise}”` : t.promise,
    summary: plan.differentiators.length ? t.diffCount(plan.differentiators.length) : undefined,
    ...status("pitch"),
    detail: detail(
      "pitch",
      <>
        {plan.promise && (
          <div className="flex flex-col gap-1.5">
            <Label>{t.promise}</Label>
            <p className="text-[16px] text-white leading-relaxed">“{plan.promise}”</p>
          </div>
        )}
        {plan.differentiators.length > 0 && (
          <div className="flex flex-col gap-2">
            <Label>{t.differentiators}</Label>
            <ul className="flex flex-col gap-2">
              {plan.differentiators.map((d, i) => (
                <li key={i} className="flex gap-2.5 text-[14px] text-[#ececec] leading-relaxed">
                  <Check />
                  <span className="min-w-0">{d}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </>
    ),
  });

  // Paquetes y precios
  nodes.push({
    id: "packages",
    label: t.blocks.packages,
    title: t.packagesCount(plan.packages.length),
    summary: plan.packages.map((p) => [p.name, p.price].filter(Boolean).join(" ")).join(" · ") || undefined,
    ...status("packages"),
    detail: detail(
      "packages",
      <>
        <div className={`grid grid-cols-1 gap-3 ${plan.packages.length >= 3 ? "lg:grid-cols-3" : plan.packages.length === 2 ? "lg:grid-cols-2" : ""}`}>
          {plan.packages.map((p, i) => (
            <div key={i} className="rounded-xl p-4 flex flex-col gap-1.5 min-w-0" style={i === 1 ? { ...INSET, boxShadow: `inset 0 0 0 1px ${RING}` } : INSET}>
              <span className="text-[14px] font-semibold text-white break-words">{p.name}</span>
              <span className="text-[22px] font-semibold tracking-tight break-words leading-tight" style={{ color: GREEN }}>
                {p.price || "—"}
              </span>
              {p.includes && <span className="text-[13px] text-[#d4d4d4] leading-relaxed">{p.includes}</span>}
              {p.note && <span className="text-[12px] text-[#8e8e8e] leading-relaxed">{p.note}</span>}
            </div>
          ))}
        </div>
        {plan.pricingNote && (
          <p className="text-[13px] text-[#a1a1a1] leading-relaxed">
            <span className="text-[#d4d4d4] font-medium">{t.pricingNote}:</span> {plan.pricingNote}
          </p>
        )}
      </>
    ),
  });

  // Oferta de bienvenida
  const offerState = plan.offer
    ? plan.offer.endsAt
      ? t.endsOn(plan.offer.endsAt)
      : plan.offer.forNewClients
        ? t.forNewClients
        : t.offerNeedsDate
    : undefined;
  nodes.push({
    id: "offer",
    label: t.blocks.offer,
    title: plan.offer?.label || t.offerNone,
    summary: offerState,
    ...status("offer"),
    detail: detail(
      "offer",
      plan.offer ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-[16px] font-semibold text-white">{plan.offer.label}</span>
          {plan.offer.detail && <span className="text-[13.5px] text-[#a1a1a1] leading-relaxed">{plan.offer.detail}</span>}
          <span className="text-[12.5px] leading-relaxed" style={{ color: plan.offer.endsAt || plan.offer.forNewClients ? GREEN : AMBER }}>
            {plan.offer.endsAt ? t.endsOn(plan.offer.endsAt) : plan.offer.forNewClients ? t.forNewClients : `${t.offerSuggested} ${t.offerNeedsDate}`}
          </span>
        </div>
      ) : (
        <span className="text-[14px] text-[#a1a1a1]">{t.offerNone}</span>
      ),
      {
        canApprove: offerOk,
        extra:
          plan.offer && !plan.approvals.offer ? (
            <button type="button" disabled={busy} onClick={onNoOffer} className="h-9 px-4 rounded-full text-[13px] text-[#d4d4d4] disabled:opacity-60" style={{ background: "rgba(255,255,255,0.04)" }}>
              {t.noOffer}
            </button>
          ) : null,
      }
    ),
  });

  // Tipo de campaña
  nodes.push({
    id: "campaign",
    label: t.blocks.campaign,
    title: plan.campaignType,
    summary: plan.channels.map((c) => c.channel).join(" · ") || undefined,
    ...status("campaign"),
    detail: detail(
      "campaign",
      <>
        <p className="text-[15px] font-medium text-white leading-relaxed">{plan.campaignType}</p>
        {plan.channels.length > 0 && (
          <ol className="flex flex-col gap-2.5">
            {plan.channels.map((c, i) => (
              <li key={i} className="flex gap-3 text-[13.5px] leading-relaxed">
                <span className="h-5 w-5 rounded-full shrink-0 flex items-center justify-center text-[11px] font-semibold mt-px" style={{ background: "rgba(255,255,255,0.06)", color: "#a1a1a1" }}>
                  {i + 1}
                </span>
                <span className="min-w-0 text-[#a1a1a1]">
                  <span className="text-[#ececec] font-medium">{c.channel}</span>
                  {c.why ? ` — ${c.why}` : ""}
                </span>
              </li>
            ))}
          </ol>
        )}
      </>
    ),
  });

  // Preguntas frecuentes
  nodes.push({
    id: "faq",
    label: t.blocks.faq,
    title: t.faqCount(plan.faq.length),
    summary: plan.faq[0]?.q,
    ...status("faq"),
    detail: detail(
      "faq",
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-4">
        {plan.faq.map((f, i) => (
          <div key={i} className="flex flex-col gap-1 min-w-0">
            <span className="text-[14px] font-medium text-white leading-snug">{f.q}</span>
            <span className="text-[13px] text-[#a1a1a1] leading-relaxed">{f.a}</span>
          </div>
        ))}
      </div>
    ),
  });

  // Video y fotos (not an approval block)
  if (plan.videoScript || plan.photoIdeas.length > 0) {
    nodes.push({
      id: "media",
      label: t.mediaLabel,
      title: plan.videoScript ? t.mediaScriptReady : t.photoCount(plan.photoIdeas.length),
      summary: plan.videoScript && plan.photoIdeas.length ? t.photoCount(plan.photoIdeas.length) : undefined,
      tone: "idle",
      detail: (
        <div className="flex flex-col gap-4 min-w-0">
          <p className="text-[13.5px] text-[#a1a1a1] leading-relaxed">{t.mediaSub}</p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {plan.videoScript && (
              <div className="flex flex-col gap-2 min-w-0">
                <Label>{t.videoScript}</Label>
                <p className="text-[14px] text-white leading-relaxed whitespace-pre-line rounded-xl p-4 break-words" style={INSET}>
                  {plan.videoScript}
                </p>
              </div>
            )}
            {plan.photoIdeas.length > 0 && (
              <div className="flex flex-col gap-2 min-w-0">
                <Label>{t.photoIdeas}</Label>
                <ul className="flex flex-col gap-2">
                  {plan.photoIdeas.map((p, i) => (
                    <li key={i} className="text-[14px] text-[#ececec] leading-relaxed flex gap-2.5">
                      <Check />
                      <span className="min-w-0">{p}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      ),
    });
  }

  // Tu zona (market research)
  const m = plan.market;
  if (m.researchedAt) {
    const lo = m.prices?.low || m.prices?.mid || "";
    const hi = m.prices?.high || m.prices?.mid || "";
    const range = lo && hi && lo !== hi ? t.priceRange(lo, hi) : lo || hi;
    const counts = [m.competitors.length ? t.competitorsCount(m.competitors.length) : "", m.gaps.length ? t.gapsCount(m.gaps.length) : ""].filter(Boolean).join(" · ");
    nodes.push({
      id: "zone",
      label: t.zoneLabel,
      title: range ? t.zonePrices(range) : counts || t.market,
      summary: range ? counts || undefined : undefined,
      tone: "idle",
      badge: m.researchedAt,
      detail: <MarketDetail plan={plan} />,
    });
  }

  // Antes de anunciar (requirements)
  if (m.requirements.length > 0) {
    const open = m.requirements.filter((r) => r.applies !== "no");
    nodes.push({
      id: "requirements",
      label: t.reqLabel,
      title: open.length ? t.reqCount(open.length) : t.reqClear,
      summary: (open[0] ?? m.requirements[0])?.item,
      tone: m.requirements.some((r) => r.applies === "yes") ? "warn" : "idle",
      detail: <RequirementsList plan={plan} />,
    });
  }

  return nodes;
}

function CenterFooter({ plan, done, t }: { plan: BusinessPlan; done: number; t: T }) {
  if (plan.stage === "approved") {
    return (
      <span className="inline-flex items-center gap-1.5 h-7 px-3 rounded-full text-[12.5px] font-semibold" style={{ background: "rgba(46,122,85,0.31)", color: GREEN }}>
        <Check size={13} />
        {t.approved}
      </span>
    );
  }
  const total = APPROVAL_BLOCKS.length;
  return (
    <div className="flex flex-col items-center gap-1.5 w-full max-w-[200px]">
      <span className="text-[12.5px] text-[#a1a1a1]">{t.approvedCount(done, total)}</span>
      <div className="h-1 w-full rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.10)" }}>
        <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${(done / total) * 100}%`, background: GREEN }} />
      </div>
    </div>
  );
}

function BlockDetail({
  id,
  plan,
  busy,
  onApprove,
  onChange,
  canApprove = true,
  extra,
  children,
}: {
  id: ApprovalBlock;
  plan: BusinessPlan;
  busy: boolean;
  onApprove: (b: ApprovalBlock) => void;
  onChange: (b: ApprovalBlock) => void;
  canApprove?: boolean;
  extra?: ReactNode;
  children: ReactNode;
}) {
  const t = PLAN_TEXT[useLang()];
  const ok = plan.approvals[id] === true;
  return (
    <div className="flex flex-col gap-4 min-w-0">
      {children}
      <div className="flex items-center gap-2 pt-4 flex-wrap" style={{ borderTop: `1px solid ${HAIR}` }}>
        {ok && (
          <span className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full text-[13px] font-semibold" style={{ background: "rgba(46,122,85,0.22)", color: GREEN }}>
            <Check size={13} />
            {t.approved}
          </span>
        )}
        {!ok && plan.stage === "proposal" && (
          <button
            type="button"
            disabled={busy || !canApprove}
            onClick={() => onApprove(id)}
            className="h-9 px-5 rounded-full text-[13px] font-semibold disabled:opacity-40"
            style={BRAND_BTN}
          >
            {t.approve}
          </button>
        )}
        <button type="button" onClick={() => onChange(id)} className="h-9 px-4 rounded-full text-[13px]" style={GHOST_BTN}>
          {t.change}
        </button>
        {extra}
      </div>
    </div>
  );
}

// ---------- header ----------

function StatusChip({ tone, children }: { tone?: "done" | "live"; children: ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[12px] h-7 px-3 rounded-full font-medium shrink-0 whitespace-nowrap"
      style={tone === "done" ? { background: "rgba(46,122,85,0.31)", color: GREEN } : { background: "rgba(255,255,255,0.05)", color: "#d4d4d4", boxShadow: `inset 0 0 0 1px ${HAIR}` }}
    >
      {tone === "live" && <span className="h-1.5 w-1.5 rounded-full animate-pulse" style={{ background: GREEN }} />}
      {children}
    </span>
  );
}

// Full labels on wide screens.
function StageBar({ labels, current }: { labels: string[]; current: number }) {
  return (
    <div className="hidden lg:flex items-center flex-wrap gap-x-1.5 gap-y-1">
      {labels.map((l, i) => (
        <div key={l} className="flex items-center gap-1.5">
          <span
            className="inline-flex items-center gap-1 text-[11.5px] px-2 py-0.5 rounded-full whitespace-nowrap"
            style={i === current ? { background: "rgba(46,122,85,0.31)", color: GREEN, fontWeight: 600 } : i < current ? { color: "#a1a1a1" } : { color: "#52525b" }}
          >
            {i < current && <Check size={11} />}
            {l}
          </span>
          {i < labels.length - 1 && <span className="h-px w-3" style={{ background: HAIR_STRONG }} />}
        </div>
      ))}
    </div>
  );
}

// Compact stepper for phones and narrow screens: "Paso 3 de 4 · Propuesta".
function StageSteps({ labels, current, t }: { labels: string[]; current: number; t: T }) {
  return (
    <div className="lg:hidden flex items-center gap-3 min-w-0">
      <span className="text-[12px] truncate min-w-0 flex-1">
        <span className="text-[#8e8e8e]">{t.step(current + 1, labels.length)} · </span>
        <span className="text-white font-medium">{labels[current]}</span>
      </span>
      <div className="flex items-center gap-1 shrink-0 w-[96px]" aria-hidden="true">
        {labels.map((l, i) => (
          <span key={l} className="h-1 flex-1 rounded-full" style={{ background: i <= current ? GREEN : "rgba(255,255,255,0.12)", opacity: i < current ? 0.55 : 1 }} />
        ))}
      </div>
    </div>
  );
}

function SectionHead({ title, sub }: { title: string; sub: string }) {
  return (
    <div>
      <h2 className="text-[20px] md:text-[22px] font-semibold text-white tracking-tight">{title}</h2>
      <p className="text-[14px] text-[#a1a1a1] mt-1 max-w-[640px] leading-relaxed">{sub}</p>
    </div>
  );
}

function Progress({ jobs, plan, compact = false }: { jobs: Job[]; plan: BusinessPlan; compact?: boolean }) {
  const t = PLAN_TEXT[useLang()];
  const label = (k: string) => {
    const v = t.tasks[k];
    if (typeof v === "function") return v(k === "prices" ? plan.profile.city : plan.profile.state);
    return v ?? k;
  };
  const list = jobs.length
    ? jobs
    : (plan.stage === "ideas_research" ? ["ideas", "ideas_pick"] : ["prices", "competitors", "requirements", "faq", "strategy", "guard"]).map((kind) => ({ kind, status: "queued" as const }));
  const icon = (j: { status: string }) =>
    j.status === "done" ? (
      <Check />
    ) : j.status === "failed" ? (
      <span style={{ color: AMBER }}>!</span>
    ) : j.status === "running" ? (
      <span className="h-2 w-2 rounded-full animate-pulse" style={{ background: ACCENT }} />
    ) : (
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: "#3a3a3a" }} />
    );
  if (compact) {
    return (
      <ul className="flex flex-col gap-1.5">
        {list.map((j) => (
          <li key={j.kind} className="flex items-center gap-2.5 text-[13.5px]" style={{ color: j.status === "queued" ? "#5b5b5b" : "#d4d4d4" }}>
            <span className="w-4 flex justify-center">{icon(j)}</span>
            {label(j.kind)}
            {j.status === "running" && "…"}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div className="rounded-2xl p-5 md:p-6 flex flex-col gap-3" style={CARD}>
      <Label>{t.working}</Label>
      <ul className="flex flex-col gap-2.5">
        {list.map((j) => (
          <li key={j.kind} className="flex items-center gap-3 text-[14.5px]" style={{ color: j.status === "queued" ? "#6b6b6b" : "#ececec" }}>
            <span className="w-5 flex justify-center">{icon(j)}</span>
            {label(j.kind)}
            {j.status === "running" && "…"}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- profile ----------

const PROFILE_LABELS: Record<"es" | "en", Partial<Record<keyof Profile, string>>> = {
  es: {
    mainService: "Servicio",
    exampleJob: "Último trabajo",
    city: "Dónde",
    yearsExperience: "Años de experiencia",
    typicalCustomer: "Cliente típico",
    currentPrice: "Cobra hoy",
    costs: "Le cuesta",
    differentiators: "Lo hace distinto",
    howGetsClients: "Consigue clientes",
    workHistory: "Ha trabajado en",
    askedFor: "Le piden ayuda con",
    tools: "Herramientas",
    hasVehicle: "Vehículo",
    hoursPerWeek: "Horas por semana",
    startBudgetUsd: "Para arrancar",
    notWant: "No quiere",
    goal: "Meta",
    languages: "Idiomas",
    licenseStatus: "Licencia",
    insured: "Seguro",
    toolsReady: "Herramientas listas",
    businessName: "Nombre del negocio",
  },
  en: {
    mainService: "Service",
    exampleJob: "Last job",
    city: "Where",
    yearsExperience: "Years of experience",
    typicalCustomer: "Typical customer",
    currentPrice: "Charges today",
    costs: "Costs",
    differentiators: "What's different",
    howGetsClients: "Gets customers",
    workHistory: "Has worked in",
    askedFor: "People ask for help with",
    tools: "Tools",
    hasVehicle: "Vehicle",
    hoursPerWeek: "Hours per week",
    startBudgetUsd: "To start",
    notWant: "Doesn't want",
    goal: "Goal",
    languages: "Languages",
    licenseStatus: "License",
    insured: "Insurance",
    toolsReady: "Tools ready",
    businessName: "Business name",
  },
};

const VALUE: Record<"es" | "en", Record<string, string>> = {
  es: { has: "Tiene", no: "No", not_needed: "No la necesita", yes: "Sí", es: "Español", en: "Inglés", both: "Español e inglés", extra: "Ingreso extra", fulltime: "Tiempo completo" },
  en: { has: "Has it", no: "No", not_needed: "Not needed", yes: "Yes", es: "Spanish", en: "English", both: "Spanish and English", extra: "Extra income", fulltime: "Full time" },
};

function ProfileCard({ plan }: { plan: BusinessPlan }) {
  const lang = useLang();
  const t = PLAN_TEXT[lang];
  const p = plan.profile;
  const rows: [string, string][] = [];
  for (const [k, label] of Object.entries(PROFILE_LABELS[lang]) as [keyof Profile, string][]) {
    let v = p[k];
    if (k === "city") v = [p.city, p.state].filter(Boolean).join(", ");
    if (k === "startBudgetUsd" && v !== null && v !== "") v = `$${Number(v).toLocaleString("en-US")}`;
    if (v === null || v === "" || v === undefined) continue;
    const s = String(v);
    rows.push([label, VALUE[lang][s] ?? s]);
  }
  const idea = plan.chosenIdea !== null ? plan.ideas[plan.chosenIdea] : null;
  if (rows.length === 0 && !idea) return null;
  return (
    <div className="rounded-2xl p-5 md:p-6 flex flex-col gap-3" style={CARD}>
      <Label>{t.expediente}</Label>
      {idea && <div className="text-[18px] font-semibold text-white">{idea.title}</div>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2.5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex flex-col min-w-0">
            <span className="text-[11px] uppercase tracking-[0.08em] text-[#6b6b6b]">{k}</span>
            <span className="text-[14px] text-[#ececec] leading-relaxed break-words">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- market research ----------

// Standalone card, used outside the strategy map (e.g. before the proposal).
function MarketCard({ plan }: { plan: BusinessPlan }) {
  const t = PLAN_TEXT[useLang()];
  return (
    <div className="rounded-2xl p-5 md:p-6 flex flex-col gap-5 min-w-0" style={CARD}>
      <span className="flex items-center gap-2">
        <Globe />
        <Label>{t.market}</Label>
      </span>
      <MarketDetail plan={plan} />
      {plan.market.requirements.length > 0 && (
        <div className="flex flex-col gap-3 pt-4" style={{ borderTop: `1px solid ${HAIR}` }}>
          <Label>{t.requirements}</Label>
          <RequirementsList plan={plan} />
        </div>
      )}
    </div>
  );
}

function MarketDetail({ plan }: { plan: BusinessPlan }) {
  const t = PLAN_TEXT[useLang()];
  const m = plan.market;
  return (
    <div className="flex flex-col gap-5 min-w-0">
      <span className="text-[12px] text-[#8e8e8e]">{t.researchedOn(m.researchedAt)}</span>

      {m.prices && (
        <div className="flex flex-col gap-2">
          <span className="text-[14px] font-semibold text-white">{t.prices}</span>
          <div className="grid grid-cols-3 gap-2 max-w-[520px]">
            {([
              [t.low, m.prices.low],
              [t.mid, m.prices.mid],
              [t.high, m.prices.high],
            ] as const).map(([k, v]) => (
              <div key={k} className="rounded-xl px-3 py-2.5 min-w-0" style={INSET}>
                <div className="text-[10.5px] uppercase tracking-[0.08em] text-[#6b6b6b]">{k}</div>
                <div className="text-[16px] md:text-[18px] font-semibold text-white break-words leading-tight mt-0.5">{v || "—"}</div>
              </div>
            ))}
          </div>
          {m.prices.includes && <p className="text-[13px] text-[#a1a1a1] leading-relaxed">{m.prices.includes}</p>}
          {m.prices.note && <p className="text-[12.5px] text-[#8e8e8e] leading-relaxed">{m.prices.note}</p>}
        </div>
      )}

      {m.competitors.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-[14px] font-semibold text-white">{t.competitors}</span>
          <div className="flex flex-col">
            {m.competitors.map((c, i) => (
              <div
                key={i}
                className="py-2.5 grid grid-cols-1 lg:grid-cols-[minmax(0,180px)_minmax(0,1fr)_minmax(0,140px)] gap-0.5 lg:gap-4 text-[13.5px]"
                style={i > 0 ? { borderTop: `1px solid ${HAIR}` } : undefined}
              >
                <span className="text-white font-medium truncate">
                  {c.url ? (
                    <a href={c.url} target="_blank" rel="noopener noreferrer nofollow" className="hover:underline">
                      {c.name} ↗
                    </a>
                  ) : (
                    c.name
                  )}
                </span>
                <span className="text-[#a1a1a1] leading-relaxed min-w-0">
                  {c.offer}
                  {c.guarantee ? ` · ${c.guarantee}` : ""}
                  {c.languages ? ` · ${c.languages}` : ""}
                </span>
                <span className="text-[#d4d4d4] lg:text-right">{c.price || t.noPrice}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {m.gaps.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[14px] font-semibold text-white">{t.gaps}</span>
          {m.gaps.map((g, i) => (
            <span key={i} className="text-[13.5px] text-[#ececec] leading-relaxed flex gap-2">
              <span className="shrink-0" style={{ color: GREEN }}>
                →
              </span>
              <span className="min-w-0">{g}</span>
            </span>
          ))}
        </div>
      )}

      {m.incomplete.length > 0 && (
        <p className="text-[12.5px] text-[#8e8e8e] leading-relaxed">
          {t.incomplete}{" "}
          {m.incomplete
            .map((k) => {
              const v = t.tasks[k];
              return typeof v === "function" ? v("") : v;
            })
            .join(", ")}
          .
        </p>
      )}
      <Sources list={m.sources} />
      <p className="text-[12px] text-[#6b6b6b] leading-relaxed">{t.marketNote}</p>
    </div>
  );
}

function RequirementsList({ plan }: { plan: BusinessPlan }) {
  const t = PLAN_TEXT[useLang()];
  return (
    <div className="flex flex-col gap-3 min-w-0">
      <span className="text-[13px] text-[#a1a1a1]">{t.requirements}</span>
      {plan.market.requirements.map((r, i) => (
        <div key={i} className="flex flex-col gap-1.5 text-[13.5px] min-w-0">
          <span
            className="text-[11px] font-medium px-2 py-0.5 rounded-full self-start"
            style={{ background: r.applies === "yes" ? "rgba(245,196,81,0.10)" : r.applies === "no" ? "rgba(46,122,85,0.22)" : "rgba(255,255,255,0.06)", color: r.applies === "yes" ? AMBER : r.applies === "no" ? GREEN : "#d4d4d4" }}
          >
            {t.applies[r.applies]}
          </span>
          <span className="text-[#ececec] leading-relaxed">
            <span className="font-medium">{r.item}</span>
            {r.note ? ` — ${r.note}` : ""}{" "}
            {r.link && (
              <a href={r.link} target="_blank" rel="noopener noreferrer nofollow" className="underline underline-offset-2 text-[#a1a1a1] hover:text-white">
                {t.officialLink}
              </a>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------- small pieces ----------

function Facts({ rows }: { rows: [string, string][] }) {
  const shown = rows.filter(([, v]) => v);
  if (!shown.length) return null;
  return (
    <div className="flex flex-col gap-2">
      {shown.map(([k, v]) => (
        <div key={k} className="text-[13.5px] leading-relaxed">
          <span className="text-[#8e8e8e]">{k}: </span>
          <span className="text-[#ececec]">{v}</span>
        </div>
      ))}
    </div>
  );
}

function Notes({ title, items, color }: { title: string; items: string[]; color: string }) {
  return (
    <div className="rounded-2xl p-4 flex flex-col gap-2" style={{ background: "#101010", boxShadow: `0 0 0 1px ${color}40` }}>
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color }}>
        {title}
      </span>
      {items.map((x, i) => (
        <span key={i} className="text-[13.5px] text-[#e4e4e7] leading-relaxed flex gap-2.5">
          <span className="h-1.5 w-1.5 rounded-full shrink-0 mt-[8px]" style={{ background: color }} />
          <span className="min-w-0">{x}</span>
        </span>
      ))}
    </div>
  );
}

function Sources({ list }: { list: { title: string; url: string }[] }) {
  const t = PLAN_TEXT[useLang()];
  if (!list.length) return null;
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      <span className="text-[12px] text-[#8e8e8e]">{t.sources}</span>
      <div className="flex flex-wrap gap-2 min-w-0">
        {list.slice(0, 8).map((s) => (
          <a
            key={s.url}
            href={s.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            title={s.url}
            className="text-[12px] px-3 py-1.5 rounded-full text-[#d4d4d4] hover:text-white max-w-full truncate"
            style={{ background: "rgba(255,255,255,0.05)", boxShadow: `inset 0 0 0 1px ${HAIR}` }}
          >
            {hostOf(s.url)} · {s.title}
          </a>
        ))}
      </div>
    </div>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#8e8e8e]">{children}</span>;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function Globe() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z" />
    </svg>
  );
}

function Check({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className={size >= 14 ? "mt-[3px] shrink-0" : "shrink-0"} aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}
