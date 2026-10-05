"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useLang } from "@/components/LangProvider";
import { PLAN_TEXT } from "@/lib/planI18n";
import { APPROVAL_BLOCKS, type ApprovalBlock, type BusinessPlan, type PlanStage, type Profile } from "@/lib/plan";
import { approveBlockAction, chooseIdeaAction, noOfferAction, sendPlanChatAction, type PlanChatResponse } from "@/app/planActions";
import ChatPanel, { type Msg } from "./ChatPanel";
import { toClientBusiness, type ClientBusiness, type ClientService, type DashboardView } from "./types";
import { ACCENT, BRAND_BTN, RING } from "@/lib/brand";

const GREEN = ACCENT;
const AMBER = "#ffc400";
const RED = "#ff6b6b";
const CARD = { background: "#111", boxShadow: "0 0 0 1px rgba(255,255,255,0.07)" } as const;
const PIPELINE: PlanStage[] = ["ideas_research", "research"];

type Job = { kind: string; status: "queued" | "running" | "done" | "failed" };
type Snapshot = { plan: BusinessPlan | null; name: string; slug: string; jobs: Job[]; messages: Msg[]; more?: boolean; error?: string };

// Cerebro = the first step of every project. The code moves the stages:
// interview → (ideas → pick → ready?) → research → proposal → approved.
// The chat is on top; the expediente fills in live below it.
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
  const change = (block: ApprovalBlock) => setPrefill({ key: Date.now(), text: t.changePrefix(t.blocks[block]) });

  return (
    <div style={{ background: "#000" }}>
      <section className="h-[calc(100dvh-118px)] md:h-screen flex flex-col">
        <div className="shrink-0 px-4 md:px-6 pt-3 pb-2 flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[17px] font-semibold text-white truncate">
              Sevrii <span className="text-[#8e8e8e] font-normal">· {t.nav.plan}</span>
              <span className="text-[#52525b] font-normal hidden sm:inline"> · {business.name}</span>
            </span>
            {plan.stage === "approved" && (
              <span className="text-[12px] px-3 py-1 rounded-full font-medium shrink-0" style={{ background: "rgba(46,122,85,0.31)", color: GREEN }}>
                {stages[current]}
              </span>
            )}
          </div>
          <StageBar labels={stages} current={current} />
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

      <section id="plan-result" className="px-4 md:px-8 pt-8 pb-14" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
        <div className={`max-w-[1100px] mx-auto flex flex-col gap-6 ${busy ? "opacity-70" : ""}`}>
          {notice && (
            <p className="text-[13.5px] rounded-xl px-4 py-3" style={{ background: "rgba(255,196,0,0.08)", color: "#f5e6b3" }}>
              {notice}
            </p>
          )}

          {pipeErr && (
            <div className="rounded-2xl p-5 flex items-center justify-between gap-4 flex-wrap" style={CARD}>
              <span className="text-[14px]" style={{ color: pipeErr === "limit" ? AMBER : RED }}>
                {pipeErr === "limit" ? t.limit : t.failed}
              </span>
              {pipeErr === "failed" && (
                <button type="button" onClick={() => setRetryKey((k) => k + 1)} className="h-10 px-5 rounded-full text-[14px] font-semibold" style={BRAND_BTN}>
                  {t.retry}
                </button>
              )}
            </div>
          )}

          {(plan.stage === "interview" || plan.stage === "ready_check") && <ProfileCard plan={plan} />}

          {plan.stage === "choose" && (
            <div className="flex flex-col gap-4">
              <div>
                <h2 className="text-[20px] font-semibold text-white">{t.ideasTitle}</h2>
                <p className="text-[14px] text-[#8e8e8e] mt-1">{t.ideasSub}</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {plan.ideas.map((idea, i) => (
                  <div key={i} className="rounded-2xl p-5 flex flex-col gap-3" style={i === 0 ? { ...CARD, boxShadow: `0 0 0 1.5px ${RING}` } : CARD}>
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[17px] font-semibold text-white leading-snug">{idea.title}</span>
                      <span className="text-[12px] px-2 py-0.5 rounded-full shrink-0" style={{ background: "rgba(46,122,85,0.26)", color: GREEN }}>
                        {t.fit(idea.score)}
                      </span>
                    </div>
                    <p className="text-[13.5px] text-[#d4d4d4] leading-relaxed">{idea.why}</p>
                    <Facts
                      rows={[
                        [t.typicalPrice, idea.typicalPrice],
                        [t.startCost, idea.startCost],
                        [t.license, idea.license],
                        [t.demand, idea.demand],
                      ]}
                    />
                    {idea.pros && <p className="text-[13px] text-[#a1a1aa]"><span style={{ color: GREEN }}>+</span> {idea.pros}</p>}
                    {idea.cons && <p className="text-[13px] text-[#a1a1aa]"><span style={{ color: AMBER }}>−</span> {idea.cons}</p>}
                    <Sources list={idea.sources} />
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => act(() => chooseIdeaAction(i))}
                      className="mt-auto h-10 rounded-full text-[14px] font-semibold"
                      style={i === 0 ? BRAND_BTN : { background: "rgba(255,255,255,0.08)", color: "#fff" }}
                    >
                      {t.choose}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(plan.stage === "proposal" || plan.stage === "approved") && (
            <div className="flex flex-col gap-4">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <h2 className="text-[20px] font-semibold text-white">{plan.stage === "approved" ? t.approvedTitle : t.proposalTitle}</h2>
                  <p className="text-[14px] text-[#8e8e8e] mt-1 max-w-[640px]">{plan.stage === "approved" ? t.approvedSub : t.proposalSub}</p>
                </div>
                <ApprovalMeter plan={plan} />
              </div>
              {plan.guard.block.length > 0 && <Notes title={t.guardBlock} items={plan.guard.block} color={RED} />}
              {plan.guard.warn.length > 0 && <Notes title={t.guardWarn} items={plan.guard.warn} color={AMBER} />}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Block id="service" plan={plan} busy={busy} onApprove={(b) => act(() => approveBlockAction(b, true))} onChange={change}>
                  <div className="text-[19px] font-semibold text-white leading-snug">{plan.service}</div>
                  <Facts
                    rows={[
                      [t.includes, plan.serviceIncludes],
                      [t.excludes, plan.serviceExcludes],
                      [t.customer, plan.customer],
                      [t.problem, plan.problem],
                    ]}
                  />
                  {plan.steps.length > 0 && (
                    <div className="flex flex-col gap-1">
                      <Label>{t.steps}</Label>
                      <ol className="flex flex-col gap-1">
                        {plan.steps.map((s, i) => (
                          <li key={i} className="text-[13.5px] text-[#d4d4d4]">
                            <span className="text-[#8e8e8e]">{i + 1}.</span> {s}
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                </Block>

                <Block id="pitch" plan={plan} busy={busy} onApprove={(b) => act(() => approveBlockAction(b, true))} onChange={change}>
                  <p className="text-[16px] text-white leading-relaxed">“{plan.promise}”</p>
                  <ul className="flex flex-col gap-2">
                    {plan.differentiators.map((d, i) => (
                      <li key={i} className="flex gap-2.5 text-[14px] text-[#ececec] leading-relaxed">
                        <Check />
                        {d}
                      </li>
                    ))}
                  </ul>
                </Block>
              </div>

              <Block id="packages" plan={plan} busy={busy} onApprove={(b) => act(() => approveBlockAction(b, true))} onChange={change}>
                <div className={`grid grid-cols-1 gap-3 ${plan.packages.length >= 3 ? "md:grid-cols-3" : plan.packages.length === 2 ? "md:grid-cols-2" : ""}`}>
                  {plan.packages.map((p, i) => (
                    <div key={i} className="rounded-xl p-4 flex flex-col gap-1.5" style={{ background: "#181818", boxShadow: i === 1 ? `0 0 0 1px ${RING}` : "none" }}>
                      <span className="text-[14.5px] font-semibold text-white">{p.name}</span>
                      <span className="text-[26px] font-semibold tracking-tight" style={{ color: GREEN }}>
                        {p.price || "—"}
                      </span>
                      {p.includes && <span className="text-[13px] text-[#d4d4d4] leading-relaxed">{p.includes}</span>}
                      {p.note && <span className="text-[12px] text-[#8e8e8e] leading-relaxed">{p.note}</span>}
                    </div>
                  ))}
                </div>
                {plan.pricingNote && (
                  <p className="text-[13px] text-[#a1a1aa] leading-relaxed">
                    <span className="text-[#d4d4d4] font-medium">{t.pricingNote}:</span> {plan.pricingNote}
                  </p>
                )}
              </Block>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Block
                  id="offer"
                  plan={plan}
                  busy={busy}
                  onApprove={(b) => act(() => approveBlockAction(b, true))}
                  onChange={change}
                  canApprove={!plan.offer || Boolean(plan.offer.endsAt)}
                  extra={
                    plan.offer && !plan.approvals.offer ? (
                      <button type="button" disabled={busy} onClick={() => act(() => noOfferAction())} className="h-9 px-4 rounded-full text-[13px] text-[#d4d4d4]" style={{ background: "rgba(255,255,255,0.06)" }}>
                        {t.noOffer}
                      </button>
                    ) : null
                  }
                >
                  {plan.offer ? (
                    <>
                      <span className="text-[16px] font-semibold text-white">{plan.offer.label}</span>
                      {plan.offer.detail && <span className="text-[13.5px] text-[#a1a1aa]">{plan.offer.detail}</span>}
                      <span className="text-[12.5px]" style={{ color: plan.offer.endsAt ? GREEN : AMBER }}>
                        {plan.offer.endsAt ? t.endsOn(plan.offer.endsAt) : `${t.offerSuggested} ${t.offerNeedsDate}`}
                      </span>
                    </>
                  ) : (
                    <span className="text-[14px] text-[#a1a1aa]">{t.offerNone}</span>
                  )}
                </Block>

                <Block id="campaign" plan={plan} busy={busy} onApprove={(b) => act(() => approveBlockAction(b, true))} onChange={change}>
                  <p className="text-[15px] font-medium text-white leading-relaxed">{plan.campaignType}</p>
                  <ol className="flex flex-col gap-1.5">
                    {plan.channels.map((c, i) => (
                      <li key={i} className="text-[13.5px] text-[#a1a1aa] leading-relaxed">
                        <span className="text-[#ececec] font-medium">
                          {i + 1}. {c.channel}
                        </span>{" "}
                        — {c.why}
                      </li>
                    ))}
                  </ol>
                </Block>
              </div>

              <Block id="faq" plan={plan} busy={busy} onApprove={(b) => act(() => approveBlockAction(b, true))} onChange={change}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
                  {plan.faq.map((f, i) => (
                    <div key={i} className="flex flex-col gap-0.5">
                      <span className="text-[14px] font-medium text-white">{f.q}</span>
                      <span className="text-[13px] text-[#a1a1aa] leading-relaxed">{f.a}</span>
                    </div>
                  ))}
                </div>
              </Block>

              {plan.stage === "approved" && (
                <div className="flex flex-wrap gap-3 pt-2">
                  <button type="button" onClick={() => onNavigate("store")} className="h-11 px-5 rounded-full text-[14.5px] font-semibold" style={BRAND_BTN}>
                    {t.goStore} →
                  </button>
                  <button type="button" onClick={() => onNavigate("marketing")} className="h-11 px-5 rounded-full text-[14.5px] font-medium text-white" style={{ background: "rgba(255,255,255,0.08)" }}>
                    {t.goMarketing} →
                  </button>
                </div>
              )}
            </div>
          )}

          {plan.market.researchedAt && <MarketCard plan={plan} />}
        </div>
      </section>
    </div>
  );
}

function StageBar({ labels, current }: { labels: string[]; current: number }) {
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
      {labels.map((l, i) => (
        <div key={l} className="flex items-center gap-1.5 shrink-0">
          <span
            className="text-[11.5px] px-2 py-0.5 rounded-full"
            style={
              i === current
                ? { background: "rgba(46,122,85,0.31)", color: GREEN, fontWeight: 600 }
                : i < current
                  ? { color: "#a1a1aa" }
                  : { color: "#52525b" }
            }
          >
            {i < current ? "✓ " : ""}
            {l}
          </span>
          {i < labels.length - 1 && <span className="h-px w-3" style={{ background: "rgba(255,255,255,0.12)" }} />}
        </div>
      ))}
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
            <span className="w-5 flex justify-center">
              {j.status === "done" ? (
                <Check />
              ) : j.status === "failed" ? (
                <span style={{ color: AMBER }}>!</span>
              ) : j.status === "running" ? (
                <span className="h-2.5 w-2.5 rounded-full animate-pulse" style={{ background: ACCENT }} />
              ) : (
                <span className="h-2 w-2 rounded-full" style={{ background: "#3a3a3a" }} />
              )}
            </span>
            {label(j.kind)}
            {j.status === "running" && "…"}
          </li>
        ))}
      </ul>
    </div>
  );
}

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
          <div key={k} className="flex flex-col">
            <span className="text-[11.5px] uppercase tracking-wider text-[#6b6b6b]">{k}</span>
            <span className="text-[14px] text-[#ececec] leading-relaxed">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Block({
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
  extra?: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = PLAN_TEXT[useLang()];
  const ok = plan.approvals[id] === true;
  return (
    <div className="rounded-2xl p-5 flex flex-col gap-3" style={ok ? { ...CARD, boxShadow: `0 0 0 1px ${RING}` } : CARD}>
      <div className="flex items-center justify-between gap-3">
        <Label>{t.blocks[id]}</Label>
        {ok && (
          <span className="text-[12px] font-semibold flex items-center gap-1" style={{ color: GREEN }}>
            <Check /> {t.approved}
          </span>
        )}
      </div>
      {children}
      <div className="flex items-center gap-2 pt-1 flex-wrap">
        {!ok && plan.stage === "proposal" && (
          <button
            type="button"
            disabled={busy || !canApprove}
            onClick={() => onApprove(id)}
            className="h-9 px-4 rounded-full text-[13px] font-semibold disabled:opacity-40"
            style={BRAND_BTN}
          >
            {t.approve}
          </button>
        )}
        <button type="button" onClick={() => onChange(id)} className="h-9 px-4 rounded-full text-[13px] text-white" style={{ background: "rgba(255,255,255,0.08)" }}>
          {t.change}
        </button>
        {extra}
      </div>
    </div>
  );
}

function ApprovalMeter({ plan }: { plan: BusinessPlan }) {
  const done = APPROVAL_BLOCKS.filter((b) => plan.approvals[b]).length;
  return (
    <div className="flex items-center gap-2.5">
      <div className="h-1.5 w-32 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
        <div className="h-full rounded-full" style={{ width: `${(done / APPROVAL_BLOCKS.length) * 100}%`, background: GREEN }} />
      </div>
      <span className="text-[12.5px] text-[#a1a1aa]">
        {done}/{APPROVAL_BLOCKS.length}
      </span>
    </div>
  );
}

function MarketCard({ plan }: { plan: BusinessPlan }) {
  const t = PLAN_TEXT[useLang()];
  const m = plan.market;
  return (
    <div className="rounded-2xl p-5 md:p-6 flex flex-col gap-5" style={CARD}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className="flex items-center gap-2">
          <Globe />
          <Label>{t.market}</Label>
        </span>
        <span className="text-[12px] text-[#8e8e8e]">{t.researchedOn(m.researchedAt)}</span>
      </div>

      {m.prices && (
        <div className="flex flex-col gap-2">
          <span className="text-[14px] font-semibold text-white">{t.prices}</span>
          <div className="grid grid-cols-3 gap-2 max-w-[520px]">
            {([
              [t.low, m.prices.low],
              [t.mid, m.prices.mid],
              [t.high, m.prices.high],
            ] as const).map(([k, v]) => (
              <div key={k} className="rounded-xl px-3 py-2.5" style={{ background: "#181818" }}>
                <div className="text-[11px] uppercase tracking-wider text-[#6b6b6b]">{k}</div>
                <div className="text-[18px] font-semibold text-white">{v || "—"}</div>
              </div>
            ))}
          </div>
          {m.prices.includes && <p className="text-[13px] text-[#a1a1aa]">{m.prices.includes}</p>}
          {m.prices.note && <p className="text-[12.5px] text-[#8e8e8e]">{m.prices.note}</p>}
        </div>
      )}

      {m.competitors.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-[14px] font-semibold text-white">{t.competitors}</span>
          <div className="flex flex-col divide-y divide-white/5">
            {m.competitors.map((c, i) => (
              <div key={i} className="py-2.5 grid grid-cols-1 md:grid-cols-[200px_1fr_140px] gap-1 md:gap-4 text-[13.5px]">
                <span className="text-white font-medium truncate">
                  {c.url ? (
                    <a href={c.url} target="_blank" rel="noopener noreferrer nofollow" className="hover:underline">
                      {c.name} ↗
                    </a>
                  ) : (
                    c.name
                  )}
                </span>
                <span className="text-[#a1a1aa]">
                  {c.offer}
                  {c.guarantee ? ` · ${c.guarantee}` : ""}
                  {c.languages ? ` · ${c.languages}` : ""}
                </span>
                <span className="text-[#d4d4d4] md:text-right">{c.price || t.noPrice}</span>
              </div>
            ))}
          </div>
          {m.gaps.length > 0 && (
            <div className="flex flex-col gap-1 pt-1">
              <span className="text-[12px] text-[#8e8e8e]">{t.gaps}</span>
              {m.gaps.map((g, i) => (
                <span key={i} className="text-[13.5px] text-[#ececec] flex gap-2">
                  <span style={{ color: GREEN }}>→</span> {g}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {m.requirements.length > 0 && (
        <div className="flex flex-col gap-2 rounded-xl p-4" style={{ background: "rgba(255,196,0,0.05)", boxShadow: "0 0 0 1px rgba(255,196,0,0.18)" }}>
          <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: AMBER }}>
            {t.requirements}
          </span>
          {m.requirements.map((r, i) => (
            <div key={i} className="flex flex-col md:flex-row md:items-baseline gap-1 md:gap-3 text-[13.5px]">
              <span className="text-[11.5px] px-2 py-0.5 rounded-full shrink-0 self-start" style={{ background: "rgba(255,255,255,0.06)", color: r.applies === "yes" ? AMBER : r.applies === "no" ? GREEN : "#d4d4d4" }}>
                {t.applies[r.applies]}
              </span>
              <span className="text-[#ececec]">
                <span className="font-medium">{r.item}</span>
                {r.note ? ` — ${r.note}` : ""}{" "}
                {r.link && (
                  <a href={r.link} target="_blank" rel="noopener noreferrer nofollow" className="underline underline-offset-2 text-[#a1a1aa] hover:text-white">
                    {t.officialLink}
                  </a>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {m.incomplete.length > 0 && (
        <p className="text-[12.5px] text-[#8e8e8e]">
          {t.incomplete} {m.incomplete.map((k) => { const v = t.tasks[k]; return typeof v === "function" ? v("") : v; }).join(", ")}.
        </p>
      )}
      <Sources list={m.sources} />
      <p className="text-[12px] text-[#6b6b6b]">{t.marketNote}</p>
    </div>
  );
}

function Facts({ rows }: { rows: [string, string][] }) {
  const shown = rows.filter(([, v]) => v);
  if (!shown.length) return null;
  return (
    <div className="flex flex-col gap-1.5">
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
    <div className="rounded-xl p-4 flex flex-col gap-1.5" style={{ background: "#141414", boxShadow: `0 0 0 1px ${color}44` }}>
      <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color }}>
        {title}
      </span>
      {items.map((x, i) => (
        <span key={i} className="text-[13.5px] text-[#e4e4e7] leading-relaxed">
          • {x}
        </span>
      ))}
    </div>
  );
}

function Sources({ list }: { list: { title: string; url: string }[] }) {
  const t = PLAN_TEXT[useLang()];
  if (!list.length) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[12px] text-[#8e8e8e]">{t.sources}</span>
      <div className="flex flex-wrap gap-2">
        {list.slice(0, 8).map((s) => (
          <a
            key={s.url}
            href={s.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            title={s.url}
            className="text-[12px] px-3 py-1.5 rounded-full text-[#d4d4d4] hover:text-white max-w-full truncate"
            style={{ background: "rgba(255,255,255,0.06)" }}
          >
            {hostOf(s.url)} · {s.title}
          </a>
        ))}
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="text-[11px] font-semibold uppercase tracking-wider text-[#8e8e8e]">{children}</span>;
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
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z" />
    </svg>
  );
}

function Check() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="mt-[3px] shrink-0">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}
