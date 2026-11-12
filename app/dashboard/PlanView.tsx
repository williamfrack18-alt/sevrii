"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useLang } from "@/components/LangProvider";
import { PLAN_TEXT } from "@/lib/planI18n";
import { APPROVAL_BLOCKS, type ApprovalBlock, type BusinessPlan, type PlanStage, type Profile } from "@/lib/plan";
import { approveBlockAction, chooseIdeaAction, confirmProposalAction, finishPlanAction, moreIdeasAction, noOfferAction, otherPackagesAction, resumePlanAction, saveCardsAction, sendPlanChatAction, type PlanChatResponse } from "@/app/planActions";
import CardFlow from "./CardFlow";
import { oneConfirmation } from "@/lib/brain/walk";
import { marketRangeText } from "@/lib/brain/checks";
import { cardTitle, unknownCards } from "@/lib/cards";
import { MAX_IDEA_ROUNDS, isRestrictedService, missingProfile, profileComplete, shownRequirements } from "@/lib/plan";
import { answerChips } from "@/lib/brain/chips";

// The hourly figure is in US dollars (to rank ideas the same way everywhere):
// outside the US it says so ("US$").
const usd = (plan: BusinessPlan) => (plan.profile.country && plan.profile.country !== "US" ? "US$" : "$");
// "CO" → "Colombia" in the screen's language ("" for none).
function countryLabel(code: string, lang: "es" | "en"): string {
  if (!/^[A-Z]{2}$/.test(code || "")) return "";
  try {
    return new Intl.DisplayNames([lang], { type: "region" }).of(code) || code;
  } catch {
    return code;
  }
}

import ChatPanel, { type ChatToken, type Msg } from "./ChatPanel";
import type { MindNode } from "./MindMap";
import ProjectDock, { StepList } from "./ProjectDock";
import { toClientBusiness, type ClientBusiness, type ClientService, type DashboardView } from "./types";
import { ACCENT, BRAND_BTN, RING } from "@/lib/panel";

const GREEN = ACCENT;
const AMBER = "#B45309";
const RED = "#DC2626";
const HAIR = "rgba(10,10,10,0.068)";
const HAIR_STRONG = "rgba(10,10,10,0.119)";
const CARD = { background: "#FFFFFF", boxShadow: "0 1px 2px rgba(10,10,10,.04), 0 10px 30px -14px rgba(10,10,10,.14), 0 0 0 1px rgba(10,10,10,.05)" } as const;
const INSET = { background: "rgba(10,10,10,0.034)", boxShadow: `inset 0 0 0 1px ${HAIR}` } as const;
const GHOST_BTN = { background: "rgba(10,10,10,0.051)", color: "#0A0A0A", boxShadow: `inset 0 0 0 1px ${HAIR}` } as const;
const PIPELINE: PlanStage[] = ["ideas_research", "research"];

type T = (typeof PLAN_TEXT)[keyof typeof PLAN_TEXT];
type Job = { kind: string; status: "queued" | "running" | "done" | "failed" };
type Snapshot = { id?: string; plan: BusinessPlan | null; name: string; slug: string; jobs: Job[]; messages: Msg[]; more?: boolean; error?: string; limitText?: string; canUpgrade?: boolean };

// Which approval block a guard note is about (the notes are free text).
const GUARD_HINTS: Record<ApprovalBlock, RegExp> = {
  service: /(licen[cs]i|seguro|insurance|revisi[oó]n de sevrii|sevrii review|alto riesgo|high[- ]risk|restringid|restricted)/i,
  pitch: /(promesa|promise|afirmaci|claim|garantiz|guarantee|el mejor|the best|rese[nñ]a|review|cifra|presenta)/i,
  packages: /(precio|price|paquete|package|tarifa|\$\s?\d)/i,
  offer: /(oferta|offer|promo|descuento|discount|fecha de fin|end date)/i,
  faq: /(pregunta|\bfaq\b|question)/i,
};

// The card token at the end of an assistant message (see lib/brain/walk.ts).
const TOKEN = /\[\[([a-z]+)(?::([a-z]+))?\]\]\s*$/;
const isBlock = (x: string): x is ApprovalBlock => (APPROVAL_BLOCKS as string[]).includes(x);
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
  // B and C (agent) both start from ideas the Brain researches.
  const ideasFlow = isB || plan.mode === "agent";
  const inPipeline = PIPELINE.includes(plan.stage);

  const [jobs, setJobs] = useState<Job[]>([]);
  const [pipeErr, setPipeErr] = useState<"" | "limit" | "failed">("");
  const [limitInfo, setLimitInfo] = useState<{ text: string; canUpgrade: boolean }>({ text: "", canUpgrade: true });
  const [sync, setSync] = useState<{ key: number; messages: Msg[] }>();
  const [prefill, setPrefill] = useState<{ key: number; text: string }>();
  const [notice, setNotice] = useState("");
  const [busy, startAction] = useTransition();
  const [retryKey, setRetryKey] = useState(0);
  // The map's detail panel opens only when the owner taps a part.
  // The chat's messages, to know which card in it is the live one.
  const [msgs, setMsgs] = useState<Msg[]>(initialMessages);

  // Latest values for the polling loop.
  const bizRef = useRef(business);
  bizRef.current = business;
  const msgCount = useRef(initialMessages.length);

  function apply(s: Snapshot) {
    // A snapshot of another project (another tab switched) never lands here.
    if (s.id && s.id !== bizRef.current.id) return;
    if (s.plan) onUpdated({ ...bizRef.current, plan: s.plan, name: s.name || bizRef.current.name, slug: s.slug || bizRef.current.slug });
    if (s.jobs) setJobs(s.jobs);
    if (s.messages && s.messages.length !== msgCount.current) {
      msgCount.current = s.messages.length;
      setMsgs(s.messages);
      setSync({ key: Date.now(), messages: s.messages });
      onMessages?.(s.messages);
    }
  }

  function applyAction(res: PlanChatResponse) {
    onUpdated(toClientBusiness(res.business), res.services.map((s) => ({ id: s.id, name: s.name, price: s.price, description: s.description })));
    msgCount.current = res.messages.length;
    setMsgs(res.messages);
    setSync({ key: Date.now(), messages: res.messages });
    onMessages?.(res.messages);
    setNotice(res.notice ?? "");
  }

  // A finished profile waiting on a research limit: continue if it's lifted.
  const waiting = (plan.stage === "interview" || plan.stage === "ready_check") && profileComplete(plan);
  useEffect(() => {
    if (!waiting) return;
    let off = false;
    resumePlanAction(bizRef.current.id)
      .then((res) => {
        if (res && !off) applyAction(res);
      })
      .catch(() => {});
    return () => {
      off = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting, business.id]);

  // Drive the research pipeline one step per request while showing progress.
  useEffect(() => {
    if (!inPipeline) return;
    let stop = false;
    setPipeErr("");
    const poll = async () => {
      try {
        const r = await fetch(`/api/brain?b=${bizRef.current.id}`, { cache: "no-store" });
        if (r.ok && !stop) apply((await r.json()) as Snapshot);
      } catch {}
    };
    const drive = async () => {
      // "busy" means another request (another tab, or the one from before a
      // reload) is running a step right now: waiting for it is not a failure,
      // so it doesn't use up the attempts. A step can take ~2.5 minutes, and
      // 20 quick "busy" answers used to show "Algo falló" (and a paid retry)
      // while the research was still going fine.
      const until = Date.now() + 10 * 60_000;
      let retry = retryKey > 0;
      for (let i = 0; i < 20 && !stop && Date.now() < until; i++) {
        let s: Snapshot;
        try {
          const r = await fetch(`/api/brain?b=${bizRef.current.id}${retry ? "&retry=1" : ""}`, { method: "POST" });
          retry = false;
          if (!r.ok) throw new Error(String(r.status));
          s = (await r.json()) as Snapshot;
        } catch {
          await new Promise((ok) => setTimeout(ok, 4000));
          continue;
        }
        if (stop) return;
        apply(s);
        if (s.error === "limit" || s.error === "failed") {
          if (s.error === "limit") setLimitInfo({ text: s.limitText || "", canUpgrade: s.canUpgrade !== false });
          setPipeErr(s.error);
          return;
        }
        if (!s.more || (s.plan && !PIPELINE.includes(s.plan.stage))) return;
        if (s.error === "busy") {
          await new Promise((ok) => setTimeout(ok, 5000));
          i--;
        }
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

  const baseStages = isB ? t.stagesB : plan.mode === "agent" ? t.stagesC : t.stagesA;
  // The last step says "Aprobado" only once the owner approved everything;
  // before that it reads as a step still to do ("Aprobación").
  const stages = plan.stage === "approved" ? baseStages : [...baseStages.slice(0, -1), lang === "es" ? "Aprobación" : "Approval"];
  const order: PlanStage[] = ideasFlow
    ? ["interview", "ideas_research", "choose", "ready_check", "research", "proposal", "approved"]
    : ["interview", "research", "proposal", "approved"];
  const current = Math.max(0, order.indexOf(plan.stage));

  // A failed request (network, server) shows a notice; uncaught, it threw out
  // of the transition and broke the whole screen.
  const act = (fn: () => Promise<PlanChatResponse>) =>
    startAction(async () => {
      try {
        applyAction(await fn());
      } catch {
        setNotice(t.chat.failed);
      }
    });
  const es = lang === "es";
  // "Cambiar" closes the map's panel and starts the request in the chat.
  const change = (block: ApprovalBlock) => {
    setPrefill({ key: Date.now(), text: t.changePrefix(t.blocks[block]) });
  };
  // One click approves: if the first request comes back without the approval
  // (and without a message saying why), it is sent once more by itself.
  const approve = (block: ApprovalBlock) =>
    act(async () => {
      const before = msgCount.current;
      const r = await approveBlockAction(block, true, bizRef.current.id);
      if (!r.business.plan.approvals[block] && r.business.plan.stage === "proposal" && r.messages.length <= before) return approveBlockAction(block, true, bizRef.current.id);
      return r;
    });

  // The review happens in the chat: the part being reviewed is the first one
  // not approved yet, and only the latest card for it has buttons.
  // A and B see the whole strategy on one card and confirm once; C goes part by part.
  const single = oneConfirmation(plan);
  // The interview is a conversation now (no mandatory cards): the Brain asks
  // only what changes the plan (lib/plan.ts missingProfile, interviewer).
  const cardsMode = false;
  const reviewing: ApprovalBlock | null = plan.stage === "proposal" && !single ? (APPROVAL_BLOCKS.find((b) => !plan.approvals[b]) ?? null) : null;
  // A strategy for a service Sevrii doesn't publish: its way forward replaces the confirmation.
  // Also before any research: A said a restricted service, or B chose one as
  // their own idea (no research is spent on it; the way out shows right away).
  const restricted = isRestrictedService(plan) && (plan.stage === "proposal" || (plan.stage === "interview" && plan.mode === "existing") || (plan.stage === "ready_check" && plan.mode === "new"));
  const lastCard = [...msgs].reverse().find((m) => m.role !== "user" && TOKEN.test(m.content));
  const lastTok = lastCard ? TOKEN.exec(lastCard.content) : null;
  const liveId =
    lastCard && lastTok
      ? (reviewing && lastTok[1] === "part" && lastTok[2] === reviewing) || (plan.stage === "choose" && lastTok[1] === "ideas") || (plan.stage === "approved" && lastTok[1] === "done") || (restricted && lastTok[1] === "restricted") || (!restricted && single && plan.stage === "proposal" && lastTok[1] === "summary")
        ? lastCard.id
        : null
      : null;
  const partCard = (id: ApprovalBlock) => (
    <PartCard
      id={id}
      plan={plan}
      busy={busy}
      onApprove={approve}
      onChange={change}
      onNoOffer={() => act(() => noOfferAction(bizRef.current.id))}
      onComplete={(block) =>
        setPrefill({
          key: Date.now(),
          text: lang === "es"
            ? `En «${t.blocks[block]}», escribe completas las frases que quedaron cortadas (terminan en «…»), sin cambiar nada más.`
            : `In "${t.blocks[block]}", write out in full the sentences that were cut off (they end in "…"), without changing anything else.`,
        })
      }
    />
  );
  // Only the last ideas card in the chat can be the one they picked from;
  // earlier rounds are options they passed on.
  const lastIdeasId = [...msgs].reverse().find((m) => m.role !== "user" && m.content.includes("[[ideas]]"))?.id ?? null;
  const lastSummaryId = [...msgs].reverse().find((m) => m.role !== "user" && m.content.includes("[[summary]]"))?.id ?? null;
  const summaryCard = (
    <SummaryCard
      plan={plan}
      busy={busy}
      onConfirm={(prices) => act(() => confirmProposalAction(prices, bizRef.current.id))}
      onOther={plan.mode === "existing" ? () => act(() => otherPackagesAction(bizRef.current.id)) : undefined}
    />
  );
  const onMore = (why: string) => act(() => moreIdeasAction(why, bizRef.current.id));
  const renderToken = ({ kind, arg, msgId }: ChatToken) => {
    if (kind === "part" && isBlock(arg)) return msgId === liveId ? partCard(arg) : <PartRow id={arg} plan={plan} stale={arg === reviewing} />;
    if (kind === "ideas") return plan.ideas.length ? <IdeasCard plan={plan} busy={busy} live={msgId === liveId} passed={msgId !== lastIdeasId} onChoose={(i) => act(() => chooseIdeaAction(i, bizRef.current.id))} onMore={onMore} /> : null;
    if (kind === "done") return <DoneCard live={msgId === liveId} onNavigate={onNavigate} payReady={business.payReady} />;
    if (kind === "market") return <MarketInChat plan={plan} />;
    if (kind === "restricted") return msgId === liveId ? restrictedCard : <PassedRow text={es ? "Servicio que Sevrii no publica" : "A service Sevrii doesn't publish"} />;
    if (kind === "summary") return msgId === liveId ? summaryCard : <PassedRow text={plan.stage === "approved" && msgId === lastSummaryId ? (es ? "Tu estrategia confirmada (la ves en «Tu estrategia»)" : "Your confirmed strategy (see \"Your strategy\")") : es ? "Tu estrategia (versión anterior)" : "Your strategy (earlier version)"} />;
    return null;
  };
  // No live card in the chat yet (an older chat, or a final check stopped
  // the plan): show what's next after the last message.
  const restrictedCard = <RestrictedCard ideas={plan.mode === "new" || plan.mode === "agent"} busy={busy} onMore={() => onMore("")} onNavigate={onNavigate} />;
  const tail = liveId
    ? null
    : restricted
      ? restrictedCard
      : single && plan.stage === "proposal"
      ? summaryCard
      : reviewing
      ? partCard(reviewing)
      : plan.stage === "proposal"
        ? <FinishCard plan={plan} busy={busy} onFinish={() => act(() => finishPlanAction(bizRef.current.id))} />
        : plan.stage === "choose" && plan.ideas.length
          ? <IdeasCard plan={plan} busy={busy} live onChoose={(i) => act(() => chooseIdeaAction(i, bizRef.current.id))} onMore={onMore} />
          : null;
  // The research is done and the plan is being written: what was found shows
  // right away, so the wait has something real to read.
  const writing = plan.stage === "research" && !pipeErr && jobs.some((j) => j.kind === "strategy" && j.status !== "queued") && jobs.some((j) => j.kind === "prices" && (j.status === "done" || j.status === "failed"));
  const foundSoFar = writing && plan.market.researchedAt ? <FoundSoFar plan={plan} /> : null;
  const tailKey = `${plan.stage}:${reviewing}:${liveId}:${busy}:${foundSoFar ? "found" : ""}`;

  const isStrategy = plan.stage === "proposal" || plan.stage === "approved";
  const doneCount = APPROVAL_BLOCKS.filter((b) => plan.approvals[b]).length;

  const chip =
    plan.stage === "approved" ? (
      <StatusChip tone="done">{stages[current]}</StatusChip>
    ) : inPipeline && !pipeErr ? (
      <StatusChip tone="live">{t.working}</StatusChip>
    ) : plan.stage === "proposal" ? (
      <StatusChip>{single ? (es ? "Por confirmar" : "To confirm") : t.approvedShort(doneCount, APPROVAL_BLOCKS.length)}</StatusChip>
    ) : null;

  // Everything stays in the chat: while it gets to know you, your file; once
  // approved, the final card with the whole strategy (each part opens in place).
  const savedFacts = Object.keys(PROFILE_LABELS[lang]).filter((k) => {
    const v = plan.profile[k as keyof Profile];
    return v !== null && v !== "" && v !== undefined;
  }).length;
  const dock =
    plan.stage === "approved" ? (
      <ProjectDock eyebrow={es ? "Tu estrategia" : "Your strategy"} title={plan.service || business.name} status={<StatusChip tone="done">{t.approved}</StatusChip>}>
        <StepList items={strategyNodes({ plan, t, onChange: change })} />
      </ProjectDock>
    ) : (plan.stage === "interview" || plan.stage === "ready_check") && savedFacts > 0 ? (
      <ProjectDock
        eyebrow={t.expediente}
        title={(plan.chosenIdea !== null ? plan.ideas[plan.chosenIdea]?.title : "") || plan.profile.mainService || business.name}
        status={<StatusChip>{es ? `${savedFacts} ${savedFacts === 1 ? "dato" : "datos"}` : `${savedFacts} ${savedFacts === 1 ? "fact" : "facts"}`}</StatusChip>}
      >
        <StepList numbered={false} items={[
            { id: "file", label: es ? "Lo que ya sé de ti" : "What I know so far", title: es ? "Toca para verlo" : "Tap to see it", detail: <ProfileCard plan={plan} bare /> },
            ...(plan.insights.length ? [{ id: "found", label: es ? "Datos reales que encontré" : "Real data I found", title: es ? "Toca para ver de dónde salen" : "Tap to see where they come from", detail: <InsightList plan={plan} /> }] : []),
          ]} />
      </ProjectDock>
    ) : undefined;
  // Notices and errors also show inside the chat, after the last message.
  const alerts = (
    <>
      {notice && (
        <p className="text-[13.5px] leading-relaxed rounded-xl px-4 py-3" style={{ background: "rgba(245,196,81,0.06)", boxShadow: "inset 0 0 0 1px rgba(245,196,81,0.22)", color: "#78350F" }}>
          {notice}
        </p>
      )}
      {pipeErr && (
        <div className="rounded-[24px] p-4 md:p-5 flex items-center justify-between gap-4 flex-wrap" style={CARD}>
          <span className="text-[14px] leading-relaxed min-w-0" style={{ color: pipeErr === "limit" ? AMBER : RED }}>
            {pipeErr === "limit" ? limitInfo.text || t.limit : t.failed}
          </span>
          {pipeErr === "limit" && limitInfo.canUpgrade && (
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
    </>
  );

  return (
    <div className="overflow-x-clip">
      <section className="chat-screen h-[calc(100dvh-var(--hdr))] md:h-screen flex flex-col">
        <div className="dash-head shrink-0 px-4 md:px-6 pt-2.5 md:pt-3 pb-2.5 flex flex-col gap-2" style={{ borderBottom: `1px solid ${HAIR}` }}>
          <div className="flex items-center justify-between gap-3 min-w-0">
            <span className="dash-title text-[16px] md:text-[17px] font-semibold text-pfg truncate min-w-0">
              <span className="hidden md:inline">
                Sevrii <span className="text-pmuted font-normal">· </span>
              </span>
              {business.name}
              <span className="text-pmuted font-normal"> · {t.nav.plan}</span>
            </span>
            {chip}
          </div>
          <StageBar labels={stages} current={current} />
          <StageSteps labels={stages} current={current} t={t} />
        </div>
        {cardsMode ? (
          <CardFlow
            key={business.id}
            mode={plan.mode as "new" | "existing"}
            initial={plan.cards}
            busy={busy}
            notice={notice}
            onSave={(answers, submit) => act(() => saveCardsAction(answers, submit, bizRef.current.id))}
          />
        ) : (
        <ChatPanel
          greeting={greeting}
          initialMessages={initialMessages}
          texts={{
            ...t.chat,
            emptyTitle: isB ? t.chat.emptyTitleB : plan.mode === "agent" ? t.chat.emptyTitleC : t.chat.emptyTitleA,
            emptySub: isB ? t.chat.emptySubB : plan.mode === "agent" ? t.chat.emptySubC : t.chat.emptySubA,
            seeBelow: "",
            seeBelowHref: "",
            // While it gets to know them, a slow reply usually means it is
            // looking up real data on the web (up to two lookups per project).
            thinkingLong: plan.stage === "interview" && plan.mode !== "agent" && plan.insightRuns < 2 && Boolean(plan.profile.mainService || plan.profile.workHistory || plan.profile.likes) ? (es ? "Buscando datos reales de tu zona…" : "Looking up real data for your area…") : undefined,
          }}
          locked={
            inPipeline && !pipeErr ? (
              <div className="flex flex-col gap-2.5 w-full">
                <span>{plan.stage === "ideas_research" ? (plan.mode === "agent" ? t.lockedIdeasC : t.lockedIdeas) : t.locked}</span>
                <Progress jobs={jobs} plan={plan} compact />
              </div>
            ) : undefined
          }
          sync={sync}
          prefill={prefill}
          chips={answerChips(plan, lang === "es", [...msgs].reverse().find((m) => m.role !== "user")?.content ?? (msgs.length ? "" : greeting))}
          renderToken={renderToken}
          tail={
            <>
              {alerts}
              {foundSoFar}
              {tail}
            </>
          }
          tailKey={`${tailKey}:${notice}:${pipeErr}`}
          composerInline={plan.mode !== "agent" && (plan.stage === "choose" || plan.stage === "proposal")}
          dock={dock}
          dockLabel={plan.stage === "approved" || plan.stage === "proposal" ? (lang === "es" ? "Tu estrategia" : "Your strategy") : lang === "es" ? "Lo que ya sé de ti" : "What I know about you"}
          onSend={async (text) => {
            const res = await sendPlanChatAction(text, bizRef.current.id);
            onUpdated(toClientBusiness(res.business), res.services.map((s) => ({ id: s.id, name: s.name, price: s.price, description: s.description })));
            msgCount.current = res.messages.length;
            setMsgs(res.messages);
            onMessages?.(res.messages);
            return { messages: res.messages, limit: res.limit, notice: res.notice };
          }}
          onPlans={() => onNavigate("plans")}
          recover={async () => {
            const r = await fetch(`/api/brain?b=${bizRef.current.id}`, { cache: "no-store" });
            if (!r.ok) return null;
            const s = (await r.json()) as Snapshot;
            apply(s);
            return s.messages ?? null;
          }}
        />
        )}
      </section>

    </div>
  );
}

// ---------- the parts of the proposal ----------

// What each part shows, in its chat card and in the map's detail panel.
function PartBody({ id, plan }: { id: ApprovalBlock; plan: BusinessPlan }) {
  const t = PLAN_TEXT[useLang()];
  switch (id) {
    case "service":
      return (
        <div className="flex flex-col gap-4 min-w-0">
          {plan.service && <p className="text-[15.5px] font-medium text-pfg leading-snug">{plan.service}</p>}
          <Facts
            rows={[
              [t.includes, plan.serviceIncludes],
              [t.excludes, plan.serviceExcludes],
              [t.customer, plan.customer],
              [t.problem, plan.problem],
            ]}
          />
          {plan.agent && <AgentBlock agent={plan.agent} />}
          {plan.steps.length > 0 && (
            <div className="flex flex-col gap-2">
              <Label>{t.steps}</Label>
              <ol className="flex flex-col gap-2">
                {plan.steps.map((s, i) => (
                  <li key={i} className="flex gap-3 text-[13.5px] text-pfg leading-relaxed">
                    <span className="h-5 w-5 rounded-full shrink-0 flex items-center justify-center text-[11px] font-semibold mt-px" style={{ background: "rgba(10,10,10,0.051)", color: "#52525B" }}>
                      {i + 1}
                    </span>
                    <span className="min-w-0">{s}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {plan.firstSteps.length > 0 && (
            <div className="flex flex-col gap-2">
              <Label>{t.firstSteps}</Label>
              <ol className="flex flex-col gap-2">
                {plan.firstSteps.map((s, i) => (
                  <li key={i} className="flex gap-3 text-[13.5px] text-pfg leading-relaxed">
                    <span className="h-5 w-5 rounded-full shrink-0 flex items-center justify-center text-[11px] font-semibold mt-px" style={{ background: "rgba(10,10,10,0.051)", color: "#52525B" }}>
                      {i + 1}
                    </span>
                    <span className="min-w-0">{s}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      );
    case "pitch":
      return (
        <div className="flex flex-col gap-4 min-w-0">
          {plan.promise && (
            <div className="flex flex-col gap-1.5">
              <Label>{t.promise}</Label>
              <p className="text-[16px] text-pfg leading-relaxed">“{plan.promise}”</p>
            </div>
          )}
          {plan.differentiators.length > 0 && (
            <div className="flex flex-col gap-2">
              <Label>{t.differentiators}</Label>
              <ul className="flex flex-col gap-2">
                {plan.differentiators.map((d, i) => (
                  <li key={i} className="flex gap-2.5 text-[14px] text-pfg leading-relaxed">
                    <Check />
                    <span className="min-w-0">{d}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      );
    case "packages":
      return (
        <div className="flex flex-col gap-3 min-w-0">
          <div className={`grid grid-cols-1 gap-3 ${plan.packages.length >= 3 ? "sm:grid-cols-3" : plan.packages.length === 2 ? "sm:grid-cols-2" : ""}`}>
            {plan.packages.map((p, i) => (
              <div key={i} className="rounded-xl p-4 flex flex-col gap-1.5 min-w-0" style={i === 1 ? { ...INSET, boxShadow: `inset 0 0 0 1px ${RING}` } : INSET}>
                <span className="text-[14px] font-semibold text-pfg break-words">{p.name}</span>
                {p.price ? (
                  <span className="text-[22px] font-semibold tracking-tight break-words leading-tight" style={{ color: p.ref ? "#52525B" : GREEN }}>
                    {p.price}
                  </span>
                ) : (
                  <span className="text-[14px] font-medium text-psub leading-tight">{t.youSetPrice}</span>
                )}
                {p.ref && p.price && (
                  <span className="self-start text-[11px] font-semibold uppercase tracking-[0.06em] px-2 py-0.5 rounded-full" style={{ background: "rgba(10,10,10,0.06)", color: "#52525B" }}>
                    {t.marketRef}
                  </span>
                )}
                {p.includes && <span className="text-[13px] text-pfg2 leading-relaxed">{p.includes}</span>}
                {p.note && <span className="text-[12px] text-pmuted leading-relaxed">{p.note}</span>}
              </div>
            ))}
          </div>
          {plan.pricingNote && (
            <p className="text-[13px] text-psub leading-relaxed">
              <span className="text-pfg2 font-medium">{t.pricingNote}:</span> {plan.pricingNote}
            </p>
          )}
          {/* What to keep in mind comes after the packages, not before. */}
          {plan.guard.warn.length > 0 && <Notes title={t.guardWarn} items={plan.guard.warn} color={AMBER} />}
        </div>
      );
    case "offer":
      return plan.offer ? (
        <div className="flex flex-col gap-1.5 min-w-0">
          <span className="text-[16px] font-semibold text-pfg">{plan.offer.label}</span>
          {plan.offer.detail && <span className="text-[13.5px] text-psub leading-relaxed">{plan.offer.detail}</span>}
          {/* The condition once: the detail already says it's for new customers, or this line does. */}
          {!(plan.offer.forNewClients && !plan.offer.endsAt && NEW_CLIENTS.test(plan.offer.detail)) && (
            <span className="text-[12.5px] leading-relaxed" style={{ color: plan.offer.endsAt || plan.offer.forNewClients ? GREEN : AMBER }}>
              {plan.offer.endsAt ? t.endsOn(plan.offer.endsAt) : plan.offer.forNewClients ? t.forNewClients : `${t.offerSuggested} ${t.offerNeedsDate}`}
            </span>
          )}
        </div>
      ) : (
        <span className="text-[14px] text-psub">{t.offerNone}</span>
      );
    case "faq":
      return (
        <div className="flex flex-col gap-4 min-w-0">
          {plan.faq.map((f, i) => (
            <div key={i} className="flex flex-col gap-1 min-w-0">
              <span className="text-[14px] font-medium text-pfg leading-snug">{f.q}</span>
              <span className="text-[13px] text-psub leading-relaxed">{f.a}</span>
            </div>
          ))}
        </div>
      );
  }
}

// C: the agent the strategy proposes (built later in Store).
// What the agent DOES end to end (it doesn't just guide).
function AgentTaskBlock({ task }: { task: NonNullable<BusinessPlan["agent"]>["task"] }) {
  const es = useLang() === "es";
  const row = (k: string, v: string) =>
    v ? (
      <span className="text-[13px] leading-relaxed">
        <span className="text-pmuted">{k}: </span>
        <span className="text-pfg">{v}</span>
      </span>
    ) : null;
  return (
    <div className="flex flex-col gap-1.5 rounded-xl p-3" style={{ background: "rgba(22,163,74,0.06)" }}>
      <span className="text-[12px] font-semibold" style={{ color: GREEN }}>{es ? "Lo que hace por el cliente, de punta a punta" : "What it does for the customer, end to end"}</span>
      <span className="text-[14px] text-pfg font-medium leading-snug">{task.goal}</span>
      {row(es ? "Opera en" : "Works on", task.platforms.map((p) => p.name).join(", "))}
      {row(es ? "Pide en el chat" : "Asks in the chat", task.needs.join(", "))}
      {row(es ? "El cliente escribe en la página oficial" : "The customer types on the official page", task.sensitive.map((x) => `${x.what} (${x.when})`).join("; "))}
      {row(es ? "Pide tu OK antes de" : "Asks your OK before", task.confirmBefore.join(", "))}
      {row(es ? "Lo da por hecho cuando" : "Done when", task.verify)}
      {row(es ? "Entrega en el chat" : "Delivers in the chat", task.deliver)}
      {row(es ? "Recordatorios" : "Reminders", task.reminders)}
    </div>
  );
}

function AgentBlock({ agent }: { agent: NonNullable<BusinessPlan["agent"]> }) {
  const t = PLAN_TEXT[useLang()];
  return (
    <div className="rounded-xl p-4 flex flex-col gap-3 min-w-0" style={{ ...INSET, boxShadow: `inset 0 0 0 1px ${RING}` }}>
      <div className="flex flex-col gap-0.5 min-w-0">
        <Label>{t.agentLabel}</Label>
        <span className="text-[15.5px] font-semibold text-pfg break-words">{agent.name}</span>
        {agent.role && <span className="text-[13.5px] text-pfg2 leading-relaxed">{agent.role}</span>}
        {agent.creator && <span className="text-[12.5px] text-pmuted">{agent.creator}</span>}
      </div>
      {agent.task?.goal && <AgentTaskBlock task={agent.task} />}
      {agent.steps.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] text-pmuted">{t.agentSteps}</span>
          <ol className="flex flex-col gap-1.5">
            {agent.steps.map((x, i) => (
              <li key={i} className="flex gap-2.5 text-[13.5px] text-pfg leading-relaxed">
                <span className="text-pmuted shrink-0 tabular-nums">{i + 1}.</span>
                <span className="min-w-0">{x}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
      {agent.limits.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] text-pmuted">{t.agentLimits}</span>
          {agent.limits.map((x, i) => (
            <span key={i} className="text-[13px] text-pfg2 leading-relaxed flex gap-2">
              <span className="shrink-0" style={{ color: AMBER }}>×</span>
              <span className="min-w-0">{x}</span>
            </span>
          ))}
        </div>
      )}
      {agent.greeting && (
        <p className="text-[13px] text-psub leading-relaxed">
          <span className="text-pfg2">{t.agentGreeting}:</span> “{agent.greeting}”
        </p>
      )}
      {(agent.edge.length > 0 || agent.freeAlt) && (
        <div className="flex flex-col gap-2 pt-3" style={{ borderTop: `1px solid ${HAIR}` }}>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span className="text-[12px] text-pmuted">{t.agentEdge}</span>
            {agent.score > 0 && (
              <span className="text-[11.5px] font-semibold px-2.5 py-0.5 rounded-full" style={agent.score >= 4 ? { background: "rgba(22,163,74,0.12)", color: GREEN } : { background: "rgba(245,196,81,0.12)", color: AMBER }}>
                {t.agentScore(agent.score)}
              </span>
            )}
          </div>
          {agent.edge.map((e, i) => (
            <span key={i} className="text-[13.5px] text-pfg leading-relaxed flex gap-2.5">
              <Check />
              <span className="min-w-0">
                {e.title && <span className="font-medium text-pfg">{e.title}: </span>}
                {e.text}
              </span>
            </span>
          ))}
          {agent.freeAlt && (
            <p className="text-[12.5px] text-pmuted leading-relaxed">
              <span className="text-psub">{t.agentFree}:</span> {agent.freeAlt}
            </p>
          )}
          {agent.score > 0 && agent.score <= 2 && <p className="text-[12.5px] leading-relaxed" style={{ color: AMBER }}>{t.agentWeak}</p>}
        </div>
      )}
    </div>
  );
}

const offerReady = (p: BusinessPlan) => !p.offer || Boolean(p.offer.endsAt) || p.offer.forNewClients;
// Review notes are internal: they never show on the owner's cards.
const notesFor = (_p: BusinessPlan, _b: ApprovalBlock): string[] => [];

// The part being reviewed, inside the chat: what it says and what to do.
function PartCard({
  id,
  plan,
  busy,
  onApprove,
  onChange,
  onNoOffer,
  onComplete,
}: {
  id: ApprovalBlock;
  plan: BusinessPlan;
  busy: boolean;
  onApprove: (b: ApprovalBlock) => void;
  onChange: (b: ApprovalBlock) => void;
  onNoOffer: () => void;
  onComplete?: (b: ApprovalBlock) => void;
}) {
  const lang = useLang();
  const t = PLAN_TEXT[lang];
  const n = APPROVAL_BLOCKS.indexOf(id);
  // Sentences an older length limit cut short (they end in "…"): the full text
  // is gone, so the Brain rewrites them on request (the owner sends it).
  const cut = cutTexts(plan, id);
  const notes = notesFor(plan, id);
  const canApprove = id !== "offer" || offerReady(plan);
  return (
    <div className="rounded-[24px] overflow-hidden min-w-0" style={{ ...CARD, boxShadow: `0 0 0 1px ${notes.length ? `${AMBER}55` : RING}` }}>
      <div className="px-4 md:px-5 pt-4 pb-3 flex items-center justify-between gap-3" style={{ borderBottom: `1px solid ${HAIR}` }}>
        <div className="flex flex-col min-w-0">
          <span className="text-[11.5px] text-pmuted">{t.partOf(n + 1, APPROVAL_BLOCKS.length)}</span>
          <span className="text-[16px] font-semibold text-pfg leading-snug">{t.blocks[id]}</span>
        </div>
        <PartDots plan={plan} current={id} />
      </div>
      <div className="px-4 md:px-5 py-4 flex flex-col gap-4 min-w-0">
        <PartBody id={id} plan={plan} />
        {cut > 0 && onComplete && (
          <div className="flex items-center justify-between gap-3 flex-wrap rounded-xl px-3 py-2.5" style={{ background: "rgba(10,10,10,0.034)" }}>
            <span className="text-[13px] text-pfg2 leading-relaxed min-w-0">
              {lang === "es"
                ? cut === 1 ? "Una frase quedó incompleta (termina en «…»)." : `${cut} frases quedaron incompletas (terminan en «…»).`
                : cut === 1 ? "One sentence was cut short (it ends in \"…\")." : `${cut} sentences were cut short (they end in "…").`}
            </span>
            <button type="button" disabled={busy} onClick={() => onComplete(id)} className="h-9 px-4 rounded-full text-[13px] font-semibold shrink-0 disabled:opacity-60" style={GHOST_BTN}>
              {lang === "es" ? "Pedir el texto completo" : "Ask for the full text"}
            </button>
          </div>
        )}
        {notes.length > 0 && (
          <div className="flex flex-col gap-1.5 rounded-xl p-3" style={{ background: "rgba(245,196,81,0.06)", boxShadow: "inset 0 0 0 1px rgba(245,196,81,0.22)" }}>
            {notes.map((x, i) => (
              <span key={i} className="text-[13px] text-[#78350F] leading-relaxed">
                {x}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="px-4 md:px-5 pb-4 flex items-center gap-2 flex-wrap">
        <button
          type="button"
          disabled={busy || !canApprove}
          onClick={() => onApprove(id)}
          className="h-10 px-5 rounded-full text-[14px] font-semibold disabled:opacity-45"
          style={BRAND_BTN}
        >
          {busy ? t.approving : t.approve}
        </button>
        <button type="button" disabled={busy} onClick={() => onChange(id)} className="h-10 px-4 rounded-full text-[14px] disabled:opacity-60" style={GHOST_BTN}>
          {t.changeSome}
        </button>
        {id === "offer" && plan.offer && (
          <button type="button" disabled={busy} onClick={onNoOffer} className="h-10 px-4 rounded-full text-[14px] text-pfg2 disabled:opacity-60" style={{ background: "rgba(10,10,10,0.025)" }}>
            {t.noOffer}
          </button>
        )}
      </div>
    </div>
  );
}

// How many texts in a part end in "…" (cut by a length limit).
function cutTexts(plan: BusinessPlan, id: ApprovalBlock): number {
  const texts =
    id === "pitch" ? [plan.promise, ...plan.differentiators]
    : id === "service" ? [plan.serviceIncludes, plan.serviceExcludes, ...plan.steps, ...plan.firstSteps]
    : id === "packages" ? plan.packages.flatMap((p) => [p.includes, p.note])
    : id === "offer" ? [plan.offer?.detail ?? ""]
    : plan.faq.flatMap((f) => [f.q, f.a]);
  return texts.filter((x) => /…$/.test((x || "").trim())).length;
}

// Six small dots: which parts are approved and which one is open.
function PartDots({ plan, current }: { plan: BusinessPlan; current: ApprovalBlock }) {
  return (
    <div className="flex items-center gap-1 shrink-0" aria-hidden="true">
      {APPROVAL_BLOCKS.map((b) => (
        <span
          key={b}
          className="h-1.5 rounded-full transition-all"
          style={{ width: b === current ? 16 : 6, background: plan.approvals[b] ? GREEN : b === current ? "#0A0A0A" : "rgba(10,10,10,0.136)" }}
        />
      ))}
    </div>
  );
}

// An earlier card in the chat: one line, opens to read it again.
function PartRow({ id, plan, stale }: { id: ApprovalBlock; plan: BusinessPlan; stale: boolean }) {
  const t = PLAN_TEXT[useLang()];
  const [open, setOpen] = useState(false);
  const ok = plan.approvals[id] === true;
  return (
    <div className="rounded-xl min-w-0" style={INSET}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="w-full flex items-center gap-3 px-4 py-3 text-left">
        {ok ? <Check size={14} /> : <span className="h-2 w-2 rounded-full shrink-0" style={{ background: "#D4D4D8" }} />}
        <span className="flex-1 min-w-0 flex flex-col">
          <span className="text-[14px] text-pfg font-medium truncate">{t.blocks[id]}</span>
          <span className="text-[12px] truncate" style={{ color: ok ? GREEN : "#71717A" }}>
            {ok ? t.approved : stale ? t.updatedBelow : t.pending}
          </span>
        </span>
        <span className="text-[12.5px] text-psub shrink-0">{open ? t.hide : t.view}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 min-w-0">
          <PartBody id={id} plan={plan} />
        </div>
      )}
    </div>
  );
}

// Every part approved but a final check stopped the plan.
function FinishCard({ plan, busy, onFinish }: { plan: BusinessPlan; busy: boolean; onFinish: () => void }) {
  const t = PLAN_TEXT[useLang()];
  return (
    <div className="rounded-[24px] p-4 md:p-5 flex flex-col gap-3 min-w-0" style={{ ...CARD, boxShadow: `0 0 0 1px ${AMBER}55` }}>
      <span className="text-[14px] text-pfg leading-relaxed">{t.finishChat}</span>
      {plan.guard.block.map((x, i) => (
        <span key={i} className="text-[13px] text-[#78350F] leading-relaxed flex gap-2.5">
          <span className="h-1.5 w-1.5 rounded-full shrink-0 mt-[8px]" style={{ background: AMBER }} />
          <span className="min-w-0">{x}</span>
        </span>
      ))}
      <button type="button" disabled={busy} onClick={onFinish} className="self-start h-10 px-5 rounded-full text-[14px] font-semibold disabled:opacity-60" style={BRAND_BTN}>
        {t.finishButton}
      </button>
    </div>
  );
}

// The plan is approved: where to go next.
// A service Sevrii doesn't publish (notary, immigration, loans, credit
// repair): no dead end. B and C look for other ideas; A starts another project.
function RestrictedCard({ ideas, busy, onMore, onNavigate }: { ideas: boolean; busy: boolean; onMore: () => void; onNavigate: (v: DashboardView) => void }) {
  const es = useLang() === "es";
  return (
    <div className="rounded-[24px] p-4 md:p-5 flex flex-col gap-3 min-w-0" style={CARD}>
      <span className="text-[16px] font-semibold text-pfg">{es ? "Este servicio no se puede publicar en Sevrii" : "This service can't be published on Sevrii"}</span>
      <p className="text-[13.5px] text-psub leading-relaxed">
        {es
          ? "Notario, trámites de inmigración, préstamos y reparación de crédito están muy regulados por la ley. Lo que ya me contaste sirve para encontrar otro servicio."
          : "Notary, immigration paperwork, loans and credit repair are heavily regulated by law. What you already told me helps find another service."}
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        {ideas ? (
          <button type="button" disabled={busy} onClick={onMore} className="h-10 px-5 rounded-full text-[14px] font-semibold disabled:opacity-50" style={BRAND_BTN}>
            ↻ {es ? "Ver otros servicios" : "See other services"}
          </button>
        ) : (
          <a href="/start?new=1" className="h-10 px-5 rounded-full text-[14px] font-semibold inline-flex items-center justify-center" style={BRAND_BTN}>
            {es ? "Crear un proyecto nuevo" : "Create a new project"}
          </a>
        )}
        <button type="button" onClick={() => onNavigate("projects")} className="h-10 px-5 rounded-full text-[14px] font-medium" style={GHOST_BTN}>
          {es ? "Ir a Inicio" : "Go to Home"}
        </button>
      </div>
    </div>
  );
}

function DoneCard({ live, onNavigate, payReady }: { live: boolean; onNavigate: (v: DashboardView) => void; payReady: boolean }) {
  const t = PLAN_TEXT[useLang()];
  if (!live) {
    return (
      <div className="rounded-xl px-4 py-3 flex items-center gap-3" style={INSET}>
        <Check size={14} />
        <span className="text-[14px] text-pfg font-medium">{t.doneShort}</span>
      </div>
    );
  }
  return (
    <div className="rounded-[24px] p-4 md:p-5 flex flex-col gap-3 min-w-0" style={{ ...CARD, boxShadow: `0 0 0 1px ${RING}` }}>
      <div className="flex items-center gap-2">
        <Check size={16} />
        <span className="text-[16px] font-semibold text-pfg">{t.doneTitle}</span>
      </div>
      <p className="text-[13.5px] text-psub leading-relaxed">{t.doneSub}</p>
      <div className="flex flex-col sm:flex-row gap-2">
        <button type="button" onClick={() => onNavigate("store")} className="h-10 px-5 rounded-full text-[14px] font-semibold" style={BRAND_BTN}>
          {t.goStore} →
        </button>
        {!payReady && (
          <button type="button" onClick={() => onNavigate("payments")} className="h-10 px-5 rounded-full text-[14px] font-medium" style={GHOST_BTN}>
            {t.goPayments} →
          </button>
        )}
        <button type="button" onClick={() => onNavigate("marketing")} className="h-10 px-5 rounded-full text-[14px] font-medium" style={GHOST_BTN}>
          {t.goMarketing} →
        </button>
      </div>
    </div>
  );
}

// The ideas (new-service path), inside the chat.
function IdeasCard({ plan, busy, live, passed = false, onChoose, onMore }: { plan: BusinessPlan; busy: boolean; live: boolean; passed?: boolean; onChoose: (i: number) => void; onMore?: (why: string) => void }) {
  const t = PLAN_TEXT[useLang()];
  const es = useLang() === "es";
  // B: the 3 best first, the rest one tap away (people compare better with few).
  const [all, setAll] = useState(false);
  const chosen = !passed && plan.chosenIdea !== null ? plan.ideas[plan.chosenIdea] : null;
  const L = plan.mode === "agent" ? t.ideasC : t;
  if (!live) {
    return (
      <div className="rounded-xl px-4 py-3 flex items-center gap-3" style={INSET}>
        {chosen ? <Check size={14} /> : <span className="h-2 w-2 rounded-full shrink-0" style={{ background: "#D4D4D8" }} />}
        <span className="text-[14px] text-pfg font-medium min-w-0 truncate">{chosen ? t.chosen(chosen.title) : passed ? t.ideasPassed : t.ideasShown}</span>
      </div>
    );
  }
  // B: the 3 best first, complete; "Ver más ideas" shows the rest, each short
  // with its details a tap away.
  const top = plan.mode === "new" ? 3 : plan.ideas.length;
  const hidden = all ? 0 : Math.max(0, plan.ideas.length - top);
  return (
    <div className={`flex flex-col min-w-0 ${plan.mode === "agent" ? "gap-3" : "gap-4"}`}>
      {plan.ideas.slice(0, plan.ideas.length - hidden).map((idea, i) => (
        <IdeaItem key={i} idea={idea} i={i} plan={plan} busy={busy} compact={plan.mode !== "agent" && i >= top} onChoose={onChoose} />
      ))}
      {hidden > 0 && (
        <button type="button" onClick={() => setAll(true)} className="self-start h-10 px-5 rounded-full text-[14px] font-medium" style={GHOST_BTN}>
          {es ? `Ver ${hidden} ideas más` : `See ${hidden} more ideas`}
        </button>
      )}
      {plan.mode === "new" && onMore ? <MoreIdeas busy={busy} onMore={onMore} /> : <p className="text-[13px] text-psub leading-relaxed">{plan.ideaRounds >= MAX_IDEA_ROUNDS ? t.moreNoLeft : t.ideasNone}</p>}
    </div>
  );
}

// "↻ Ver otros servicios": a new batch. Every option shown here is remembered
// as rejected and never comes back (checked in code); the optional reasons
// weigh on the next batch.
function MoreIdeas({ busy, onMore, label, help }: { busy: boolean; onMore: (why: string) => void; label?: string; help?: string }) {
  const es = useLang() === "es";
  const reasons = es
    ? ["Pagan poco", "Toman mucho tiempo", "No me gustan", "Prefiero digital", "Prefiero en persona", "Cuestan mucho para empezar"]
    : ["They pay too little", "They take too much time", "I don't like them", "I'd rather go digital", "I'd rather work in person", "Too costly to start"];
  const [why, setWhy] = useState<string[]>([]);
  const [text, setText] = useState("");
  const toggle = (r: string) => setWhy((w) => (w.includes(r) ? w.filter((x) => x !== r) : [...w, r]));
  return (
    <div className="rounded-[26px] p-5 md:p-7 flex flex-col gap-4" style={{ background: "#F5F5F2" }}>
      <div className="flex flex-col gap-1">
        <span className="text-[16px] font-semibold" style={{ color: "#0A0A0A" }}>{es ? "¿Ninguna te convence?" : "None of these?"}</span>
        <span className="text-[13.5px]" style={{ color: "#52525B" }}>{help ?? (es ? "Dime por qué (opcional) y te traigo otras distintas. Ninguna de estas vuelve a salir." : "Tell me why (optional) and I'll bring different ones. None of these will come back.")}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {reasons.map((r) => {
          const on = why.includes(r);
          return (
            <button key={r} type="button" onClick={() => toggle(r)} aria-pressed={on} className="h-10 px-4 rounded-full text-[13.5px]" style={on ? { background: "#0A0A0A", color: "#fff", fontWeight: 600 } : { background: "#fff", color: "#0A0A0A", boxShadow: "inset 0 0 0 1px rgba(10,10,10,0.1)" }}>
              {on ? "✓ " : ""}
              {r}
            </button>
          );
        })}
      </div>
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder={es ? "Otra razón (opcional)" : "Another reason (optional)"} className="h-12 rounded-2xl px-4 text-[14.5px] outline-none bg-white" style={{ boxShadow: "inset 0 0 0 1px rgba(10,10,10,0.1)" }} />
      <button type="button" disabled={busy} onClick={() => onMore([...why, text.trim()].filter(Boolean).join("; "))} className="self-start h-12 px-6 rounded-full text-[15px] font-semibold disabled:opacity-60 inline-flex items-center gap-2" style={{ background: "#0A0A0A", color: "#fff" }}>
        <span aria-hidden="true" className="text-[17px] leading-none">↻</span> {label ?? (es ? "Ver otros servicios" : "See other services")}
      </button>
    </div>
  );
}

function PassedRow({ text }: { text: string }) {
  return (
    <div className="rounded-xl px-4 py-3 flex items-center gap-3" style={INSET}>
      <span className="h-2 w-2 rounded-full shrink-0" style={{ background: "#D4D4D8" }} />
      <span className="text-[14px] text-pfg font-medium min-w-0 truncate">{text}</span>
    </div>
  );
}

// A and B: the strategy as its 5 parts, one card under the other and each one
// complete (service, presentation, packages, offer, FAQ). A package that shows a
// market reference can get the owner's own price right here; one button at the
// end confirms everything (that is the approval) and opens Store.
function SummaryCard({ plan, busy, onConfirm, onOther }: { plan: BusinessPlan; busy: boolean; onConfirm: (prices: Record<string, string>) => void; onOther?: () => void }) {
  const lang = useLang();
  const t = PLAN_TEXT[lang];
  const es = lang === "es";
  const [prices, setPrices] = useState<Record<string, string>>({});
  const unknown = unknownCards(plan.mode, plan.cards);
  const card = (n: number, title: string, body: ReactNode) => (
    <article className="rounded-[26px] bg-white p-5 md:p-7 flex flex-col gap-4 min-w-0" style={{ boxShadow: "0 1px 2px rgba(10,10,10,0.04), 0 16px 36px -22px rgba(10,10,10,0.22), 0 0 0 1px rgba(10,10,10,0.05)" }}>
      <header className="flex items-center gap-3">
        <span className="h-8 w-8 rounded-full shrink-0 flex items-center justify-center text-[14px] font-semibold" style={{ background: "#0A0A0A", color: "#fff" }}>{n}</span>
        <h3 className="text-[18px] font-semibold" style={{ color: "#0A0A0A" }}>{title}</h3>
      </header>
      {body}
    </article>
  );
  // A ("más clientes"): the plan to get more clients comes first; it's what
  // this person came for.
  const g = plan.growth;
  const growthOn = plan.mode === "existing" && Boolean(g.diagnosis || g.idealClient || g.actions.length || plan.channels.length);
  const o = growthOn ? 1 : 0;
  return (
    <div className="flex flex-col gap-4 min-w-0">
      <div className="flex flex-col gap-1 px-1">
        <span className="text-[12px] font-semibold uppercase tracking-[0.08em]" style={{ color: GREEN }}>{growthOn ? (es ? "Tu plan para más clientes · 6 partes" : "Your plan for more clients · 6 parts") : es ? "Tu estrategia · 5 partes" : "Your strategy · 5 parts"}</span>
        <span className="text-[19px] font-semibold text-pfg leading-snug">{plan.service}</span>
      </div>
      {growthOn && card(1, es ? "Cómo conseguir más clientes" : "How to get more clients", <GrowthBody plan={plan} />)}
      {card(
        1 + o,
        t.blocks.service,
        <>
          <PartBody id="service" plan={plan} />
          {plan.serviceWhy && (
            <p className="text-[13px] text-psub leading-relaxed rounded-2xl px-4 py-3" style={{ background: "#F5F5F2" }}>
              <span className="text-pfg2 font-medium">{es ? "Por qué te lo propongo (solo lo ves tú)" : "Why I suggest it (only you see this)"}:</span> {plan.serviceWhy}
            </p>
          )}
        </>
      )}
      {card(2 + o, t.blocks.pitch, <PartBody id="pitch" plan={plan} />)}
      {card(
        3 + o,
        t.blocks.packages,
        <div className="flex flex-col gap-3">
          {plan.packages.map((p, i) => (
            <div key={i} className="rounded-2xl p-4 flex flex-col gap-2 min-w-0" style={{ background: "#F5F5F2" }}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-[15px] font-semibold text-pfg">{p.name}</span>
                {p.price ? <span className="text-[19px] font-semibold" style={{ color: p.ref ? "#52525B" : GREEN }}>{p.price}</span> : <span className="text-[13.5px] font-medium text-psub">{t.youSetPrice}</span>}
              </div>
              {p.includes && <span className="text-[13.5px] text-pfg2 leading-relaxed">{p.includes}</span>}
              {p.ref ? (
                <div className="flex flex-col gap-1.5">
                  <span className="text-[12.5px] text-pmuted">
                    {p.price ? (
                      <>
                        <b className="font-semibold">{t.marketRef}</b> · {es ? "lo que se cobra en tu zona, no es tu precio. Escribe el tuyo si ya lo sabes:" : "what's charged in your area, not your price. Type yours if you know it:"}
                      </>
                    ) : es ? (
                      "No encontré un precio publicado para este trabajo y no quise inventarlo. Escribe el tuyo si ya lo sabes:"
                    ) : (
                      "I didn't find a published price for this job and didn't want to make one up. Type yours if you know it:"
                    )}
                  </span>
                  <input
                    value={prices[String(i)] ?? ""}
                    onChange={(e) => setPrices((x) => ({ ...x, [String(i)]: e.target.value }))}
                    placeholder={es ? "Tu precio, con tu moneda" : "Your price, with your currency"}
                    inputMode="decimal"
                    className="h-11 rounded-xl px-4 text-[14.5px] outline-none bg-white"
                    style={{ boxShadow: "inset 0 0 0 1px rgba(10,10,10,0.12)" }}
                  />
                </div>
              ) : (
                <span className="text-[12.5px] font-medium" style={{ color: GREEN }}>{es ? "Tu precio" : "Your price"}</span>
              )}
            </div>
          ))}
          {plan.pricingNote && <p className="text-[13.5px] text-psub leading-relaxed">{plan.pricingNote}</p>}
          {plan.guard.warn.length > 0 && <Notes title={t.guardWarn} items={plan.guard.warn} color={AMBER} />}
        </div>
      )}
      {card(4 + o, t.blocks.offer, <PartBody id="offer" plan={plan} />)}
      {card(5 + o, t.blocks.faq, plan.faq.length ? <PartBody id="faq" plan={plan} /> : <span className="text-[14px] text-psub">—</span>)}
      {unknown.length > 0 && (
        <p className="text-[13.5px] leading-relaxed rounded-2xl px-4 py-3" style={{ background: "rgba(245,158,11,0.08)", color: "#78350F" }}>
          {es ? "Contestaste «no sé» en: " : "You answered \"don't know\" on: "}
          {unknown.map((id) => cardTitle(plan.mode, id, lang).replace(/[¿?]/g, "")).join(" · ")}. {es ? "No supuse nada en su lugar." : "I didn't assume anything instead."}
        </p>
      )}
      <div className="rounded-[26px] p-5 md:p-7 flex flex-col gap-3" style={{ background: "#F5F5F2" }}>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" disabled={busy} onClick={() => onConfirm(prices)} className="h-12 px-7 rounded-full text-[15.5px] font-semibold disabled:opacity-60" style={{ background: "#0A0A0A", color: "#fff" }}>
            {busy ? (es ? "Confirmando…" : "Confirming…") : es ? "Confirmar y crear mi página" : "Confirm and build my page"}
          </button>
          {onOther && (
            <button type="button" disabled={busy} onClick={onOther} className="h-12 px-5 rounded-full text-[14.5px] font-medium disabled:opacity-60 inline-flex items-center gap-2" style={{ background: "#fff", color: "#0A0A0A", boxShadow: "inset 0 0 0 1px rgba(10,10,10,0.14)" }}>
              <span aria-hidden="true" className="text-[17px] leading-none">↻</span> {es ? "Ver otra presentación" : "See another presentation"}
            </button>
          )}
        </div>
        <span className="text-[13px] text-psub">
          {onOther
            ? es
              ? "«Ver otra presentación» cambia solo cómo te presentas; tu servicio y tus precios se quedan igual. ¿Otro cambio? Escríbelo abajo."
              : "\"See another presentation\" changes only how you present yourself; your service and your prices stay the same. Another change? Write it below."
            : es
              ? "¿Quieres cambiar algo? Escríbelo abajo y actualizo las tarjetas."
              : "Want to change something? Write it below and I'll update the cards."}
        </span>
      </div>
    </div>
  );
}

// A ("más clientes"): why more clients don't come yet, who to sell to first,
// their price against the market, where to reach them and three things for
// this week. On the confirmation card and, once approved, in "Tu estrategia".
function GrowthBody({ plan }: { plan: BusinessPlan }) {
  const es = useLang() === "es";
  const g = plan.growth;
  const row = (label: string, body: ReactNode) => (
    <div className="flex flex-col gap-1">
      <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-pmuted">{label}</span>
      <div className="text-[14.5px] text-pfg2 leading-relaxed">{body}</div>
    </div>
  );
  return (
    <div className="flex flex-col gap-4">
      {g.diagnosis && row(es ? "Por qué hoy no te llegan más" : "Why more don't come today", g.diagnosis)}
      {g.idealClient && row(es ? "A quién venderle primero" : "Who to sell to first", g.idealClient)}
      {g.priceVsMarket && row(es ? "Tu precio frente al mercado" : "Your price vs. the market", g.priceVsMarket)}
      {plan.channels.length > 0 &&
        row(
          es ? "Por dónde llegarles" : "Where to reach them",
          <ul className="flex flex-col gap-1.5">
            {plan.channels.map((c, i) => (
              <li key={i}>
                <b className="font-semibold text-pfg">{c.channel}</b>
                {c.why ? ` — ${c.why}` : ""}
              </li>
            ))}
          </ul>
        )}
      {g.actions.length > 0 &&
        row(
          es ? (g.actions.length === 3 ? "Tres cosas para esta semana" : "Para esta semana") : g.actions.length === 3 ? "Three things for this week" : "For this week",
          <ol className="flex flex-col gap-3">
            {g.actions.map((a, i) => (
              <li key={i} className="flex gap-3 min-w-0">
                <span className="h-6 w-6 rounded-full shrink-0 flex items-center justify-center text-[12px] font-semibold mt-px" style={{ background: "rgba(10,10,10,0.07)", color: "#27272A" }}>{i + 1}</span>
                <ActionText text={a} />
              </li>
            ))}
          </ol>
        )}
      {plan.market.sources.length > 0 && <Sources list={plan.market.sources.slice(0, 5)} />}
    </div>
  );
}

// An action with its ready-to-use text: what goes between «» shows as a block
// with a button to copy it (a message, the name of a profile, a sign).
function ActionText({ text }: { text: string }) {
  const es = useLang() === "es";
  const [copied, setCopied] = useState(-1);
  const parts = text
    .split(/(«[^»]{12,}»)/g)
    .map((x, i) => (x.startsWith("«") ? x : i === 0 ? x.trim() : x.replace(/^[\s:.,;]+/, "").trim()))
    .filter(Boolean);
  const copy = async (value: string, i: number) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(i);
      setTimeout(() => setCopied(-1), 1800);
    } catch {}
  };
  return (
    <div className="min-w-0 flex flex-col gap-2">
      {parts.map((x, i) =>
        x.startsWith("«") && x.endsWith("»") ? (
          <div key={i} className="rounded-2xl px-4 py-3 flex flex-col gap-2 min-w-0" style={{ background: "rgba(10,10,10,0.045)", boxShadow: "inset 0 0 0 1px rgba(10,10,10,0.07)" }}>
            <span className="text-[14px] text-pfg leading-relaxed whitespace-pre-line break-words">{x.slice(1, -1)}</span>
            <button type="button" onClick={() => copy(x.slice(1, -1), i)} className="self-start h-8 px-3.5 rounded-full text-[12.5px] font-semibold" style={{ background: "#0A0A0A", color: "#fff" }}>
              {copied === i ? (es ? "Copiado ✓" : "Copied ✓") : es ? "Copiar texto" : "Copy text"}
            </button>
          </div>
        ) : (
          <span key={i} className="min-w-0">{x}</span>
        )
      )}
    </div>
  );
}

// Real prices with a name ("Vélez · restauración de calzado · $159.900").
function PriceExamples({ plan, max = 6 }: { plan: BusinessPlan; max?: number }) {
  const list = (plan.market.examples ?? []).slice(0, max);
  if (!list.length) return null;
  return (
    <div className="flex flex-col">
      {list.map((e, i) => (
        <div key={i} className="py-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 text-[13.5px]" style={i > 0 ? { borderTop: `1px solid ${HAIR}` } : undefined}>
          <span className="min-w-0">
            <span className="text-pfg font-medium">
              {e.url ? (
                <a href={e.url} target="_blank" rel="noopener noreferrer nofollow" className="hover:underline">
                  {e.who} ↗
                </a>
              ) : (
                e.who
              )}
            </span>
            {e.what ? <span className="text-psub"> · {e.what}</span> : null}
          </span>
          <span className="text-pfg font-semibold tabular-nums">{e.price}</span>
        </div>
      ))}
    </div>
  );
}

// While the plan is being written: what the research already found.
function FoundSoFar({ plan }: { plan: BusinessPlan }) {
  const lang = useLang();
  const t = PLAN_TEXT[lang];
  const es = lang === "es";
  const m = plan.market;
  const range = priceSpan(m.prices, t);
  const names = m.competitors.map((c) => c.name).filter(Boolean).slice(0, 4);
  const nothing = !m.examples.length && !range && !names.length && !m.gaps.length;
  return (
    <div className="rounded-[24px] p-4 md:p-5 flex flex-col gap-4 min-w-0" style={{ ...CARD, animation: "dash-fade .35s ease both" }}>
      <span className="flex items-center gap-2">
        <Globe />
        <Label>{es ? "Lo que ya encontré" : "What I found so far"}</Label>
      </span>
      {nothing ? (
        <p className="text-[14px] text-psub leading-relaxed">{es ? "Encontré poca información publicada sobre este servicio en tu zona. Armo tu plan con lo que me contaste y te digo con claridad qué no pude confirmar." : "I found little published information about this service in your area. I'm building your plan from what you told me, and I'll say clearly what I couldn't confirm."}</p>
      ) : (
        <>
          {m.examples.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-[13.5px] font-semibold text-pfg">{es ? "Precios reales, con nombre" : "Real prices, with a name"}</span>
              <PriceExamples plan={plan} max={4} />
            </div>
          )}
          {range && <span className="text-[13.5px] text-pfg2">{t.zonePrices(range)}</span>}
          {names.length > 0 && (
            <span className="text-[13.5px] text-pfg2 leading-relaxed">
              <b className="font-semibold text-pfg">{es ? "Quién aparece cuando te buscan: " : "Who shows up when people search: "}</b>
              {names.join(", ")}
            </span>
          )}
          {m.gaps.slice(0, 2).map((x, i) => (
            <span key={i} className="text-[13.5px] text-pfg leading-relaxed flex gap-2">
              <span className="shrink-0" style={{ color: GREEN }}>→</span>
              <span className="min-w-0">{x}</span>
            </span>
          ))}
        </>
      )}
      <span className="text-[12.5px] text-pmuted">{es ? "Con esto estoy armando tu plan. Ya casi." : "I'm building your plan with this. Almost there."}</span>
    </div>
  );
}

// The facts the Brain looked up while chatting, each with its source.
function InsightList({ plan }: { plan: BusinessPlan }) {
  return (
    <ul className="flex flex-col gap-3">
      {plan.insights.map((x, i) => (
        <li key={i} className="flex flex-col gap-1 text-[13.5px] leading-relaxed min-w-0">
          <span className="text-pfg">{x.fact}</span>
          {x.url ? (
            <a href={x.url} target="_blank" rel="noopener noreferrer nofollow" className="text-[12px] text-pmuted hover:underline truncate">
              {x.source || hostOf(x.url)} ↗
            </a>
          ) : x.source ? (
            <span className="text-[12px] text-pmuted">{x.source}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function IdeaItem(props: { idea: BusinessPlan["ideas"][number]; i: number; plan: BusinessPlan; busy: boolean; compact: boolean; onChoose: (i: number) => void }) {
  return props.plan.mode === "agent" ? <AgentIdeaItem {...props} /> : <ServiceIdeaItem {...props} />;
}

// B: one service option per card, complete and in this order: title, what it
// does, for whom, digital / in person / mixed, approximate pay per hour, score,
// and the market reference (what's charged and what it costs to start).
function ServiceIdeaItem({ idea, i, plan, busy, onChoose }: { idea: BusinessPlan["ideas"][number]; i: number; plan: BusinessPlan; busy: boolean; compact: boolean; onChoose: (i: number) => void }) {
  const lang = useLang();
  const t = PLAN_TEXT[lang];
  const es = lang === "es";
  const [open, setOpen] = useState(false);
  const mode = idea.delivery === "digital" ? "Digital" : idea.delivery === "fisico" ? (es ? "Físico" : "In person") : idea.delivery === "ambos" ? (es ? "Mixto" : "Mixed") : "";
  const row = (label: string, value: ReactNode) =>
    value ? (
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-[11.5px] font-semibold uppercase tracking-[0.07em]" style={{ color: "#71717A" }}>{label}</span>
        <div className="text-[14.5px] leading-relaxed min-w-0 break-words" style={{ color: "#0A0A0A" }}>{value}</div>
      </div>
    ) : null;
  return (
    <article className="rounded-[26px] bg-white p-5 md:p-7 flex flex-col gap-5 min-w-0" style={{ boxShadow: "0 1px 2px rgba(10,10,10,0.04), 0 16px 36px -22px rgba(10,10,10,0.22), 0 0 0 1px rgba(10,10,10,0.05)" }}>
      <header className="flex items-start gap-3">
        <span className="h-8 w-8 rounded-full shrink-0 flex items-center justify-center text-[14px] font-semibold" style={{ background: "#0A0A0A", color: "#fff" }}>{i + 1}</span>
        <h3 className="text-[18px] md:text-[19px] font-semibold leading-snug min-w-0 break-words pt-0.5" style={{ color: "#0A0A0A" }}>{idea.title}</h3>
      </header>
      <div className="flex flex-col gap-4">
        {row(es ? "Qué hace" : "What it is", idea.what || idea.why)}
        {row(es ? "Para quién" : "For whom", idea.forWhom)}
        <div className="grid grid-cols-3 gap-3">
          {row(es ? "Modalidad" : "Format", mode && <span className="inline-flex h-7 items-center px-3 rounded-full text-[13px] font-medium" style={{ background: "rgba(10,10,10,0.06)" }}>{mode}</span>)}
          {row(es ? "Pago aprox." : "Approx. pay", idea.hourlyUsd ? <b className="font-semibold tabular-nums">≈ {usd(plan)}{idea.hourlyUsd}/{es ? "hora" : "hour"}</b> : null)}
          {row(es ? "Puntaje" : "Score", idea.score > 0 ? <span className="font-semibold tabular-nums" style={{ color: GREEN }}>{t.fit(idea.score)}</span> : null)}
        </div>
        {(idea.typicalPrice || idea.startCost) && (
          <div className="rounded-2xl px-4 py-3 flex flex-col gap-1" style={{ background: "#F5F5F2" }}>
            <span className="text-[11.5px] font-semibold uppercase tracking-[0.07em]" style={{ color: "#71717A" }}>{t.marketRef}</span>
            {idea.typicalPrice && (
              <span className="text-[14px]" style={{ color: "#27272A" }}>
                {es ? "Se cobra" : "Charged"}: <b className="font-semibold">{idea.typicalPrice}</b>
              </span>
            )}
            {idea.startCost && (
              <span className="text-[14px]" style={{ color: "#27272A" }}>
                {es ? "Cuesta empezar" : "Cost to start"}: {idea.startCost}
              </span>
            )}
          </div>
        )}
        {idea.usesUnknown.length > 0 && (
          <p className="text-[13px] leading-relaxed" style={{ color: AMBER }}>
            {es ? "Supone algo que respondiste «no sé»: " : "Relies on something you answered \"don't know\": "}
            {idea.usesUnknown.map((id) => cardTitle(plan.mode, id, lang)).join(" · ")}
          </p>
        )}
      </div>
      {open && (
        <div className="flex flex-col gap-4 pt-4" style={{ borderTop: `1px solid ${HAIR}` }}>
          {row(es ? "Por qué te puede servir" : "Why it may suit you", idea.what ? idea.why : "")}
          {row(es ? "Qué necesitas para empezar" : "What you need to start", idea.needs)}
          {row(t.license, idea.license && !/^no\b/i.test(idea.license.trim()) ? idea.license : "")}
          {row(t.demand, idea.demand)}
          {idea.steps.length > 0 &&
            row(
              es ? "Primeros pasos" : "First steps",
              <ol className="flex flex-col gap-1.5 mt-1">
                {idea.steps.map((x, k) => (
                  <li key={k} className="flex gap-2.5">
                    <span className="h-5 w-5 rounded-full shrink-0 flex items-center justify-center text-[11px] font-semibold mt-0.5" style={{ background: "rgba(10,10,10,0.06)", color: "#52525B" }}>{k + 1}</span>
                    <span className="min-w-0">{x}</span>
                  </li>
                ))}
              </ol>
            )}
          {(idea.pros || idea.cons) && (
            <div className="flex flex-col gap-1.5">
              {idea.pros && (
                <p className="text-[13.5px] text-psub leading-relaxed flex gap-2">
                  <span className="shrink-0 font-semibold" style={{ color: GREEN }}>+</span>
                  <span className="min-w-0">{idea.pros}</span>
                </p>
              )}
              {idea.cons && (
                <p className="text-[13.5px] text-psub leading-relaxed flex gap-2">
                  <span className="shrink-0 font-semibold" style={{ color: AMBER }}>−</span>
                  <span className="min-w-0">{idea.cons}</span>
                </p>
              )}
            </div>
          )}
          <Sources list={idea.sources} />
        </div>
      )}
      <footer className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={busy} onClick={() => onChoose(i)} className="h-11 px-6 rounded-full text-[15px] font-semibold disabled:opacity-60" style={{ background: "#0A0A0A", color: "#fff" }}>
          {t.choose}
        </button>
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="h-11 px-3 text-[14px] underline-offset-4 hover:underline" style={{ color: "#52525B" }}>
          {open ? (es ? "Ver menos" : "Show less") : es ? "Ver detalles" : "See details"}
        </button>
      </footer>
    </article>
  );
}

function AgentIdeaItem({ idea, i, plan, busy, compact, onChoose }: { idea: BusinessPlan["ideas"][number]; i: number; plan: BusinessPlan; busy: boolean; compact: boolean; onChoose: (i: number) => void }) {
  const lang = useLang();
  const t = PLAN_TEXT[lang];
  const L = plan.mode === "agent" ? t.ideasC : t;
  const [open, setOpen] = useState(!compact);
  const es = lang === "es";
  return (
    <div className="rounded-[24px] p-4 md:p-5 flex flex-col gap-3 min-w-0" style={i === 0 ? { ...CARD, boxShadow: `0 0 0 1px ${RING}` } : CARD}>
      <div className="flex items-start justify-between gap-3">
        <span className="text-[16px] font-semibold text-pfg leading-snug min-w-0 break-words">
          <span className="text-pmuted font-normal">{i + 1}. </span>
          {idea.title}
        </span>
        <span className="flex items-center gap-1.5 shrink-0">
          {plan.mode !== "agent" && idea.hourlyUsd ? (
            <span className="text-[12px] px-2 py-0.5 rounded-full font-semibold tabular-nums" style={{ background: "#0A0A0A", color: "#fff" }} title={es ? "Lo que se gana por hora de trabajo en tu zona (estimado de la investigación)" : "What it pays per hour of work in your area (estimated from the research)"}>
              ≈ {usd(plan)}{idea.hourlyUsd}/{es ? "hora" : "hour"}
            </span>
          ) : null}
          {idea.score > 0 && (
            <span className="text-[12px] px-2 py-0.5 rounded-full font-medium" style={{ background: "rgba(22,163,74,0.12)", color: GREEN }}>
              {t.fit(idea.score)}
            </span>
          )}
        </span>
      </div>
      {plan.mode !== "agent" && (idea.what || idea.forWhom || idea.delivery) ? (
        <div className="flex flex-col gap-1">
          {idea.what && <p className="text-[14px] text-pfg leading-relaxed">{idea.what}</p>}
          <p className="text-[13px] text-psub leading-relaxed">
            {idea.forWhom && (
              <>
                {es ? "Para" : "For"}: <span className="text-pfg2">{idea.forWhom}</span>
              </>
            )}
            {idea.delivery && (
              <span className="ml-2 inline-flex items-center h-6 px-2.5 rounded-full text-[12px] font-medium align-middle" style={{ background: "rgba(10,10,10,0.06)", color: "#3F3F46" }}>
                {idea.delivery === "digital" ? "Digital" : idea.delivery === "fisico" ? (es ? "Físico" : "In person") : es ? "Digital o físico" : "Digital or in person"}
              </span>
            )}
          </p>
        </div>
      ) : (
        <p className={`text-[13.5px] text-pfg2 leading-relaxed ${open ? "" : "line-clamp-2"}`}>{idea.why}</p>
      )}
      {plan.mode !== "agent" && (idea.typicalPrice || idea.startCost) && (
        <div className="rounded-xl px-3.5 py-2.5 flex flex-col gap-0.5" style={INSET}>
          <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-pmuted">{t.marketRef}</span>
          {idea.typicalPrice && (
            <span className="text-[13px] text-pfg2">
              {es ? "Se cobra" : "Charged"}: <b className="font-semibold text-pfg">{idea.typicalPrice}</b>
            </span>
          )}
          {idea.startCost && (
            <span className="text-[13px] text-pfg2">
              {es ? "Para empezar" : "To start"}: {idea.startCost}
            </span>
          )}
        </div>
      )}
      {plan.mode !== "agent" && idea.usesUnknown.length > 0 && (
        <p className="text-[12.5px] leading-relaxed" style={{ color: AMBER }}>
          {es ? "Supone algo que respondiste «no sé»: " : "Relies on something you answered \"don't know\": "}
          {idea.usesUnknown.map((id) => cardTitle(plan.mode, id, lang)).join(" · ")}
        </p>
      )}
      {open && (
        <>
          <Facts
            rows={
              plan.mode === "agent"
                ? [
                    [t.ideasC.how, idea.how],
                    [L.typicalPrice, idea.typicalPrice],
                    [L.demand, idea.demand],
                    [L.license, idea.license],
                    [L.startCost, idea.startCost],
                  ]
                : [
                    [es ? "Por qué te puede servir" : "Why it may suit you", idea.what ? idea.why : ""],
                    [es ? "Qué necesitas para empezar" : "What you need to start", idea.needs],
                    [L.license, idea.license && !/^no\b/i.test(idea.license.trim()) ? idea.license : ""],
                    [L.demand, idea.demand],
                  ]
            }
          />
          {plan.mode !== "agent" && idea.steps.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-pmuted">{es ? "Pasos para empezar" : "Steps to start"}</span>
              <ol className="flex flex-col gap-1.5">
                {idea.steps.map((x, k) => (
                  <li key={k} className="flex gap-2.5 text-[13.5px] text-pfg leading-relaxed">
                    <span className="h-5 w-5 rounded-full shrink-0 flex items-center justify-center text-[11px] font-semibold mt-px" style={{ background: "rgba(10,10,10,0.051)", color: "#52525B" }}>{k + 1}</span>
                    <span className="min-w-0">{x}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {(idea.pros || idea.cons) && (
            <div className="flex flex-col gap-1.5">
              {idea.pros && (
                <p className="text-[13px] text-psub leading-relaxed flex gap-2">
                  <span className="shrink-0 font-semibold" style={{ color: GREEN }}>+</span>
                  <span className="min-w-0">{idea.pros}</span>
                </p>
              )}
              {idea.cons && (
                <p className="text-[13px] text-psub leading-relaxed flex gap-2">
                  <span className="shrink-0 font-semibold" style={{ color: AMBER }}>−</span>
                  <span className="min-w-0">{idea.cons}</span>
                </p>
              )}
            </div>
          )}
          <Sources list={idea.sources} />
        </>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy} onClick={() => onChoose(i)} className="h-10 px-5 rounded-full text-[14px] font-semibold disabled:opacity-60" style={i === 0 ? BRAND_BTN : GHOST_BTN}>
          {t.choose}
        </button>
        {compact && (
          <button type="button" onClick={() => setOpen((v) => !v)} className="h-10 px-4 rounded-full text-[13.5px] text-psub hover:text-pfg">
            {open ? (es ? "Ver menos" : "Show less") : es ? "Ver detalles" : "See details"}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------- strategy map (a read-only summary under the chat) ----------

function strategyNodes({ plan, t, onChange }: { plan: BusinessPlan; t: T; onChange: (b: ApprovalBlock) => void }): MindNode[] {
  const status = (b: ApprovalBlock): Pick<MindNode, "tone" | "badge"> => {
    const ok = plan.approvals[b] === true;
    return { tone: ok ? "done" : notesFor(plan, b).length || (b === "offer" && !offerReady(plan)) ? "warn" : "idle", badge: ok ? t.approved : t.toApprove };
  };
  const detail = (b: ApprovalBlock) => (
    <div className="flex flex-col gap-4 min-w-0">
      <PartBody id={b} plan={plan} />
      <div className="flex items-center gap-2 pt-4 flex-wrap" style={{ borderTop: `1px solid ${HAIR}` }}>
        {plan.approvals[b] && (
          <span className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full text-[13px] font-semibold" style={{ background: "rgba(22,163,74,0.12)", color: GREEN }}>
            <Check size={13} />
            {t.approved}
          </span>
        )}
        <button type="button" onClick={() => onChange(b)} className="h-9 px-4 rounded-full text-[13px]" style={GHOST_BTN}>
          {t.changeInChat}
        </button>
      </div>
    </div>
  );

  const nodes: MindNode[] = [];
  // A: the plan to get more clients is what they came for: it stays first.
  const g = plan.growth;
  if (plan.mode === "existing" && (g.diagnosis || g.idealClient || g.actions.length || plan.channels.length)) {
    const es = t === PLAN_TEXT.es;
    nodes.push({
      id: "growth",
      label: es ? "Cómo conseguir más clientes" : "How to get more clients",
      title: g.idealClient || g.diagnosis || (es ? "Tu plan" : "Your plan"),
      summary: g.actions.length ? (es ? `${g.actions.length} acciones para esta semana` : `${g.actions.length} actions for this week`) : undefined,
      tone: "done",
      badge: t.approved,
      detail: <GrowthBody plan={plan} />,
    });
  }
  nodes.push({ id: "service", label: t.blocks.service, title: plan.serviceIncludes || plan.service, summary: plan.problem || undefined, ...status("service"), detail: detail("service") });
  nodes.push({
    id: "pitch",
    label: t.blocks.pitch,
    title: plan.promise ? `“${plan.promise}”` : t.promise,
    summary: plan.differentiators.length ? t.diffCount(plan.differentiators.length) : undefined,
    ...status("pitch"),
    detail: detail("pitch"),
  });
  nodes.push({
    id: "packages",
    label: t.blocks.packages,
    title: t.packagesCount(plan.packages.length),
    summary: plan.packages.map((p) => [p.name, p.price].filter(Boolean).join(" ")).join(" · ") || undefined,
    ...status("packages"),
    detail: detail("packages"),
  });
  const offerState = plan.offer ? (plan.offer.endsAt ? t.endsOn(plan.offer.endsAt) : plan.offer.forNewClients ? t.forNewClients : t.offerNeedsDate) : undefined;
  nodes.push({ id: "offer", label: t.blocks.offer, title: plan.offer?.label || t.offerNone, summary: offerState, ...status("offer"), detail: detail("offer") });
  nodes.push({ id: "faq", label: t.blocks.faq, title: t.faqCount(plan.faq.length), summary: plan.faq[0]?.q, ...status("faq"), detail: detail("faq") });

  // Tu zona (market research)
  const m = plan.market;
  if (m.researchedAt) {
    const range = priceSpan(m.prices, t);
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
  if (shownRequirements(plan).length > 0) {
    const open = shownRequirements(plan).filter((r) => r.applies !== "no");
    nodes.push({
      id: "requirements",
      label: t.reqLabel,
      title: open.length ? t.reqCount(open.length) : t.reqClear,
      summary: (open[0] ?? shownRequirements(plan)[0])?.item,
      tone: shownRequirements(plan).some((r) => r.applies === "yes") ? "warn" : "idle",
      detail: <RequirementsList plan={plan} />,
    });
  }

  return nodes;
}

function CenterFooter({ plan, done, t }: { plan: BusinessPlan; done: number; t: T }) {
  if (plan.stage === "approved") {
    return (
      <span className="inline-flex items-center gap-1.5 h-7 px-3 rounded-full text-[12.5px] font-semibold" style={{ background: "rgba(22,163,74,0.12)", color: GREEN }}>
        <Check size={13} />
        {t.approved}
      </span>
    );
  }
  const total = APPROVAL_BLOCKS.length;
  return (
    <div className="flex flex-col items-center gap-1.5 w-full max-w-[200px]">
      <span className="text-[12.5px] text-psub">{t.approvedCount(done, total)}</span>
      <div className="h-1 w-full rounded-full overflow-hidden" style={{ background: "rgba(10,10,10,0.085)" }}>
        <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${(done / total) * 100}%`, background: GREEN }} />
      </div>
    </div>
  );
}

// ---------- header ----------

function StatusChip({ tone, children }: { tone?: "done" | "live"; children: ReactNode }) {
  return (
    <span
      className="dash-chip-s inline-flex items-center gap-1.5 text-[12px] h-7 px-3 rounded-full font-medium shrink-0 whitespace-nowrap"
      style={tone === "done" ? { background: "rgba(22,163,74,0.12)", color: GREEN } : { background: "rgba(10,10,10,0.043)", color: "#27272A", boxShadow: `inset 0 0 0 1px ${HAIR}` }}
    >
      {tone === "live" && <span className="h-1.5 w-1.5 rounded-full animate-pulse" style={{ background: GREEN }} />}
      {children}
    </span>
  );
}

// Full labels on wide screens.
function StageBar({ labels, current }: { labels: string[]; current: number }) {
  return (
    <div className="dash-stage hidden lg:flex items-center flex-wrap gap-x-1.5 gap-y-1">
      {labels.map((l, i) => (
        <div key={l} className="flex items-center gap-1.5">
          <span
            className={`inline-flex items-center gap-1 text-[11.5px] px-2 py-0.5 rounded-full whitespace-nowrap ${i === current ? "dash-stage-on" : ""}`}
            style={i === current ? { background: "rgba(22,163,74,0.12)", color: GREEN, fontWeight: 600 } : i < current ? { color: "#52525B" } : { color: "#52525b" }}
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
    <div className="dash-steps lg:hidden flex items-center gap-3 min-w-0">
      <span className="text-[12px] truncate min-w-0 flex-1">
        <span className="text-pmuted">{t.step(current + 1, labels.length)} · </span>
        <span className="text-pfg font-medium">{labels[current]}</span>
      </span>
      <div className="flex items-center gap-1 shrink-0 w-[96px]" aria-hidden="true">
        {labels.map((l, i) => (
          <span key={l} className={`h-1 flex-1 rounded-full ${i <= current ? "" : "dash-step-off"}`} style={{ background: i <= current ? GREEN : "rgba(10,10,10,0.102)", opacity: i < current ? 0.55 : 1 }} />
        ))}
      </div>
    </div>
  );
}

function SectionHead({ title, sub }: { title: string; sub: string }) {
  return (
    <div>
      <h2 className="text-[20px] md:text-[22px] font-semibold text-pfg tracking-tight">{title}</h2>
      <p className="text-[14px] text-psub mt-1 max-w-[640px] leading-relaxed">{sub}</p>
    </div>
  );
}

function Progress({ jobs, plan, compact = false }: { jobs: Job[]; plan: BusinessPlan; compact?: boolean }) {
  const lang = useLang();
  const t = PLAN_TEXT[lang];
  const label = (k: string) => {
    if (k === "ideas" && plan.mode === "agent") return t.ideasC.task;
    if (k === "strategy" && plan.mode === "existing") return lang === "es" ? "Armando tu plan para más clientes" : "Building your plan for more clients";
    const v = t.tasks[k];
    if (typeof v === "function") return v(k === "prices" ? plan.profile.city : plan.profile.state || plan.profile.region || countryLabel(plan.profile.country, lang));
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
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: "#F0F0ED" }} />
    );
  if (compact) {
    return (
      <ul className="flex flex-col gap-1.5">
        {list.map((j) => (
          <li key={j.kind} className="flex items-center gap-2.5 text-[13.5px]" style={{ color: j.status === "queued" ? "#5b5b5b" : "#27272A" }}>
            <span className="w-4 flex justify-center">{icon(j)}</span>
            {label(j.kind)}
            {j.status === "running" && "…"}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div className="rounded-[24px] p-5 md:p-6 flex flex-col gap-3" style={CARD}>
      <Label>{t.working}</Label>
      <ul className="flex flex-col gap-2.5">
        {list.map((j) => (
          <li key={j.kind} className="flex items-center gap-3 text-[14.5px]" style={{ color: j.status === "queued" ? "#A1A1AA" : "#0A0A0A" }}>
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
    agentInterest: "Le interesa",
    agentTask: "Cómo trabaja el agente",
    agentLimits: "Límites del agente",
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
    agentInterest: "Interested in",
    agentTask: "How the agent works",
    agentLimits: "Agent limits",
    businessName: "Business name",
  },
};

const VALUE: Record<"es" | "en", Record<string, string>> = {
  es: { has: "Tiene", no: "No", not_needed: "No la necesita", yes: "Sí", es: "Español", en: "Inglés", both: "Español e inglés", extra: "Ingreso extra", fulltime: "Tiempo completo" },
  en: { has: "Has it", no: "No", not_needed: "Not needed", yes: "Yes", es: "Spanish", en: "English", both: "Spanish and English", extra: "Extra income", fulltime: "Full time" },
};

function ProfileCard({ plan, bare = false }: { plan: BusinessPlan; bare?: boolean }) {
  const lang = useLang();
  const t = PLAN_TEXT[lang];
  const p = plan.profile;
  const rows: [string, string][] = [];
  for (const [k, label] of Object.entries(PROFILE_LABELS[lang]) as [keyof Profile, string][]) {
    let v = p[k];
    // Any country: city, state or region, and the country ("Medellín, Colombia"); online says so.
    if (k === "city") v = [p.city, p.state || p.region, p.country && p.country !== "US" ? countryLabel(p.country, lang) : ""].filter(Boolean).join(", ") || (p.serviceMode === "remote" ? [lang === "es" ? "En línea" : "Online", countryLabel(p.country, lang)].filter(Boolean).join(" · ") : "");
    if (k === "startBudgetUsd" && v !== null && v !== "") v = p.country && p.country !== "US" ? Number(v).toLocaleString(lang) : `$${Number(v).toLocaleString("en-US")}`;
    if (v === null || v === "" || v === undefined) continue;
    const s = String(v);
    rows.push([label, VALUE[lang][s] ?? s]);
  }
  const idea = plan.chosenIdea !== null ? plan.ideas[plan.chosenIdea] : null;
  if (rows.length === 0 && !idea) return null;
  return (
    <div className={bare ? "flex flex-col gap-3" : "rounded-[24px] p-5 md:p-6 flex flex-col gap-3"} style={bare ? undefined : CARD}>
      {!bare && <Label>{t.expediente}</Label>}
      {idea && <div className="text-[18px] font-semibold text-pfg">{idea.title}</div>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2.5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex flex-col min-w-0">
            <span className="text-[11px] uppercase tracking-[0.08em] text-pfaint">{k}</span>
            <span className="text-[14px] text-pfg leading-relaxed break-words">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- market research ----------

// Standalone card, used outside the strategy map (e.g. before the proposal).
// The research, inside the chat right where it finished: a summary line that
// opens in place, and what to keep in mind before going on.
function MarketInChat({ plan }: { plan: BusinessPlan }) {
  const t = PLAN_TEXT[useLang()];
  const [open, setOpen] = useState(false);
  const m = plan.market;
  if (!m.researchedAt) return null;
  const range = priceSpan(m.prices, t);
  const counts = [m.competitors.length ? t.competitorsCount(m.competitors.length) : "", m.gaps.length ? t.gapsCount(m.gaps.length) : ""].filter(Boolean).join(" · ");
  return (
    <div className="flex flex-col gap-3 min-w-0">
      <div className="rounded-[24px] min-w-0" style={CARD}>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="w-full flex items-center gap-3 px-4 md:px-5 py-4 text-left">
          <Globe />
          <span className="flex-1 min-w-0 flex flex-col">
            <span className="text-[14.5px] text-pfg font-medium">{t.market}</span>
            <span className="text-[12.5px] text-psub break-words">{[range ? t.zonePrices(range) : "", counts].filter(Boolean).join(" · ")}</span>
          </span>
          <span className="text-[12.5px] text-psub shrink-0">{open ? t.hide : t.view}</span>
        </button>
        {open && (
          <div className="px-4 md:px-5 pb-5 flex flex-col gap-5 min-w-0">
            <MarketDetail plan={plan} />
            {shownRequirements(plan).length > 0 && plan.stage !== "approved" && (
              <div className="flex flex-col gap-3 pt-4" style={{ borderTop: `1px solid ${HAIR}` }}>
                <Label>{t.requirements}</Label>
                <RequirementsList plan={plan} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function MarketCard({ plan }: { plan: BusinessPlan }) {
  const t = PLAN_TEXT[useLang()];
  return (
    <div className="rounded-[24px] p-5 md:p-6 flex flex-col gap-5 min-w-0" style={CARD}>
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
      <span className="text-[12px] text-pmuted">{t.researchedOn(m.researchedAt)}</span>

      {
        <div className="flex flex-col gap-2">
          <span className="text-[14px] font-semibold text-pfg">{t.prices}</span>
          {!m.prices?.low && !m.prices?.mid && !m.prices?.high && !m.examples.length && <p className="text-[13px] text-psub leading-relaxed">{t.noPricesFound}</p>}
          <div className={m.prices?.low || m.prices?.mid || m.prices?.high ? "grid grid-cols-3 gap-2 max-w-[520px]" : "hidden"}>
            {([
              [t.low, m.prices?.low ?? ""],
              [t.mid, m.prices?.mid ?? ""],
              [t.high, m.prices?.high ?? ""],
            ] as const).filter(([, v]) => v).map(([k, v]) => (
              <div key={k} className="rounded-xl px-3 py-2.5 min-w-0" style={INSET}>
                <div className="text-[10.5px] uppercase tracking-[0.08em] text-pfaint">{k}</div>
                <div className="text-[16px] md:text-[18px] font-semibold text-pfg break-words leading-tight mt-0.5">{v || "—"}</div>
              </div>
            ))}
          </div>
          <PriceExamples plan={plan} />
          {m.prices?.includes && <p className="text-[13px] text-psub leading-relaxed">{m.prices.includes}</p>}
          {m.prices?.note && <p className="text-[12.5px] text-pmuted leading-relaxed">{m.prices.note}</p>}
        </div>
      }

      {m.competitors.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-[14px] font-semibold text-pfg">{t.competitors}</span>
          <div className="flex flex-col">
            {m.competitors.map((c, i) => (
              <div
                key={i}
                className="py-2.5 grid grid-cols-1 lg:grid-cols-[minmax(0,180px)_minmax(0,1fr)_minmax(0,140px)] gap-0.5 lg:gap-4 text-[13.5px]"
                style={i > 0 ? { borderTop: `1px solid ${HAIR}` } : undefined}
              >
                <span className="text-pfg font-medium truncate">
                  {c.url ? (
                    <a href={c.url} target="_blank" rel="noopener noreferrer nofollow" className="hover:underline">
                      {c.name} ↗
                    </a>
                  ) : (
                    c.name
                  )}
                </span>
                <span className="text-psub leading-relaxed min-w-0">
                  {c.offer}
                  {c.guarantee ? ` · ${c.guarantee}` : ""}
                  {c.languages ? ` · ${c.languages}` : ""}
                </span>
                <span className="text-pfg2 lg:text-right">{c.price || t.noPrice}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {m.gaps.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[14px] font-semibold text-pfg">{t.gaps}</span>
          {m.gaps.map((g, i) => (
            <span key={i} className="text-[13.5px] text-pfg leading-relaxed flex gap-2">
              <span className="shrink-0" style={{ color: GREEN }}>
                →
              </span>
              <span className="min-w-0">{g}</span>
            </span>
          ))}
        </div>
      )}

      {m.incomplete.length > 0 && (
        <p className="text-[12.5px] text-pmuted leading-relaxed">
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
      <p className="text-[12px] text-pfaint leading-relaxed">{t.marketNote}</p>
    </div>
  );
}

function RequirementsList({ plan }: { plan: BusinessPlan }) {
  const t = PLAN_TEXT[useLang()];
  return (
    <div className="flex flex-col gap-3 min-w-0">
      {plan.market.requirements.map((r, i) => (
        <div key={i} className="flex flex-col gap-1.5 text-[13.5px] min-w-0">
          <span
            className="text-[11px] font-medium px-2 py-0.5 rounded-full self-start"
            style={{ background: r.applies === "yes" ? "rgba(245,196,81,0.10)" : r.applies === "no" ? "rgba(22,163,74,0.12)" : "rgba(10,10,10,0.051)", color: r.applies === "yes" ? AMBER : r.applies === "no" ? GREEN : "#27272A" }}
          >
            {t.applies[r.applies]}
          </span>
          <span className="text-pfg leading-relaxed">
            <span className="font-medium">{r.item}</span>
            {r.note ? ` — ${r.note}` : ""}{" "}
            {r.link && (
              <a href={r.link} target="_blank" rel="noopener noreferrer nofollow" className="underline underline-offset-2 text-psub hover:text-pfg">
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
      {shown.map(([k, v]) => {
        // A menu written as "a; b; c" reads better as a list.
        const items = v.split(/;\s+/).map((x) => x.trim().replace(/[.;]$/, "")).filter(Boolean);
        return items.length >= 2 ? (
          <div key={k} className="text-[13.5px] leading-relaxed flex flex-col gap-1">
            <span className="text-pmuted">{k}:</span>
            <ul className="flex flex-col gap-1">
              {items.map((x, i) => (
                <li key={i} className="flex gap-2 text-pfg">
                  <span className="shrink-0 text-pmuted">•</span>
                  <span className="min-w-0">{x.charAt(0).toUpperCase() + x.slice(1)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div key={k} className="text-[13.5px] leading-relaxed">
            <span className="text-pmuted">{k}: </span>
            <span className="text-pfg">{v}</span>
          </div>
        );
      })}
    </div>
  );
}

// "$95–$155 por visita" … "$280–$525+ por visita" → "de $95 a $525+ por visita"
// (one range from the lowest to the highest, never a range of ranges).
function priceSpan(p: BusinessPlan["market"]["prices"], t: T): string {
  // Any currency ("$95", "40 €", "45.000 COP"): the same text the Brain cites.
  return marketRangeText(p, t === PLAN_TEXT.en ? "en" : "es");
}

const NEW_CLIENTS = /(nuev[oa]s?|new (clients?|customers?)|primer[ao]? (servicio|visita|compra|limpieza|trabajo)|first (service|visit|purchase|time))/i;

function Notes({ title, items, color }: { title: string; items: string[]; color: string }) {
  return (
    <div className="rounded-[24px] p-4 flex flex-col gap-2" style={{ background: "#FFFFFF", boxShadow: `0 0 0 1px ${color}40` }}>
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color }}>
        {title}
      </span>
      {items.map((x, i) => (
        <span key={i} className="text-[13.5px] text-pfg leading-relaxed flex gap-2.5">
          <span className="h-1.5 w-1.5 rounded-full shrink-0 mt-[8px]" style={{ background: color }} />
          <span className="min-w-0">{x}</span>
        </span>
      ))}
    </div>
  );
}

function Sources({ list }: { list: { title: string; url: string; description?: string }[] }) {
  const t = PLAN_TEXT[useLang()];
  if (!list.length) return null;
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      <span className="text-[12px] text-pmuted">{t.sources}</span>
      <div className="flex flex-wrap gap-2 min-w-0">
        {list.slice(0, 8).map((s) => (
          <a
            key={s.url}
            href={s.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            title={s.description ? `${s.description} — ${s.url}` : s.url}
            className="text-[12px] px-3 py-1.5 rounded-full text-pfg2 hover:text-pfg max-w-full truncate"
            style={{ background: "rgba(10,10,10,0.043)", boxShadow: `inset 0 0 0 1px ${HAIR}` }}
          >
            {hostOf(s.url)} · {s.title}
          </a>
        ))}
      </div>
    </div>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-pmuted">{children}</span>;
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
