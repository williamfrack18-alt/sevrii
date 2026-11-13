import {
  addChatMessage,
  claimResearchJob,
  createResearchRun,
  getBusinessById,
  latestResearchRun,
  listChatMessages,
  requeueFailedJobs,
  setResearchJob,
  updateBusinessDetails,
  updateBusinessPlan,
  type ResearchJobRow,
} from "../db";
import type { Lang } from "../i18n";
import { countAiUnit, researchGate, runForUser } from "../usage";
import { allow, clear } from "../guard";
import { IDEAS_TOKEN, MARKET_TOKEN, nextPartMessage } from "./walk";
import { parseIdeas, parseMarket, parsePlan, type BusinessPlan, type PlanSource, type PlanStage } from "../plan";
import { runResearch, researchFailedLog, type ResearchKind } from "./research";
import { pickIdeas, proposePlan } from "./strategist";
import { guardPlan, keptPriceIssue } from "./guard";
import { avoidedIssue, withoutAvoided, hasJargon, knownAmounts, moneyAmounts, markReferencePrices, marketRangeText, mentionsDiscount, noFakeCosts, silentProposalIssues, withoutDiscounts, dropUnbackedRefs, noLanguageClaims, unbackedRefIssues } from "./checks";
import { oneConfirmation } from "./walk";
import { today } from "./common";

// The research pipeline, driven by the client one step per request so no
// request runs longer than a few minutes: first the web research in
// parallel, then the Strategist, then the Guardian. Every step is a row in
// research_jobs, so the screen shows progress and a dead step is retried.

export const PIPELINE_STAGES: PlanStage[] = ["ideas_research", "research"];

const STEPS: Record<"ideas_research" | "research", { parallel: ResearchKind[]; then: string[] }> = {
  ideas_research: { parallel: ["ideas"], then: ["ideas_pick"] },
  research: { parallel: ["prices", "competitors", "requirements", "faq"], then: ["strategy", "guard"] },
};

// Research runs per account per month and the AI budget come from the plan (lib/usage.ts).

// The lock that lets one request start the run of a stage (per project,
// stage and round of ideas: "Dame otras" is a new round, so a new run).
export const NEW_RUN_LOCK_SECONDS = 60;
export function newRunLock(businessId: string, plan: Pick<BusinessPlan, "stage" | "ideaRounds">): string {
  return `brain:newrun:${businessId}:${plan.stage}:${plan.ideaRounds}`;
}

export type AdvanceResult = { more: boolean; error?: "limit" | "failed" | "busy" };

function jobOf(jobs: ResearchJobRow[], kind: string) {
  return jobs.find((j) => j.kind === kind);
}
const finished = (j?: ResearchJobRow) => j?.status === "done" || j?.status === "failed";

async function savePlan(businessId: string, plan: BusinessPlan) {
  await updateBusinessPlan(businessId, parsePlan(plan));
}

export async function advancePipeline(businessId: string, userId: string, lang: Lang, retry = false): Promise<AdvanceResult> {
  const b = await getBusinessById(businessId);
  if (!b) return { more: false };
  if (b.plan.stage !== "ideas_research" && b.plan.stage !== "research") return { more: false };
  // Every AI call of this step is measured as research (see lib/usage.ts).
  // The research and the proposal are written in the language the flow runs in.
  const flow: Lang = b.plan.flowLang || lang;
  return runForUser(userId, () => advanceStep(b, businessId, userId, flow, retry), b.plan.stage === "ideas_research" ? "brain_ideas" : "brain_research");
}

async function advanceStep(b: NonNullable<Awaited<ReturnType<typeof getBusinessById>>>, businessId: string, userId: string, lang: Lang, retry: boolean): Promise<AdvanceResult> {
  let plan = b.plan;
  if (plan.stage !== "ideas_research" && plan.stage !== "research") return { more: false };
  const spec = STEPS[plan.stage];
  const ideaRefresh = plan.stage === "ideas_research" && plan.ideaRounds > 0;

  let jobs = await latestResearchRun(businessId);
  if (!plan.runId || jobs.length === 0 || jobs[0].runId !== plan.runId) {
    // Only one request starts the run of this stage: two tabs (or a reload)
    // used to start two paid runs at once, both counted against the plan.
    // The other one waits ("busy") and then follows the run this one saved.
    if (!(await allow(newRunLock(businessId, plan), 1, NEW_RUN_LOCK_SECONDS))) return { more: true, error: "busy" };
    // Each new run counts against the plan's monthly runs and AI budget.
    if (await researchGate(userId, undefined, { budgetOnly: ideaRefresh })) {
      await clear(newRunLock(businessId, plan));
      return { more: false, error: "limit" };
    }
    const runId = await createResearchRun(businessId, [...spec.parallel, ...spec.then]);
    plan = { ...plan, runId };
    await savePlan(businessId, plan);
    jobs = await latestResearchRun(businessId);
  } else if (retry && jobs.some((j) => j.status === "failed")) {
    // A retry re-runs paid research, so it counts like a new run (only when
    // something really failed: a retry of a run still going costs nothing).
    if (await researchGate(userId, undefined, { budgetOnly: ideaRefresh })) return { more: false, error: "limit" };
    await requeueFailedJobs(plan.runId);
    jobs = await latestResearchRun(businessId);
  }
  const runId = plan.runId;

  // 1) Web research, in parallel.
  const pending = spec.parallel.filter((k) => !finished(jobOf(jobs, k)));
  if (pending.length) {
    const claimed = (await Promise.all(pending.map(async (k) => ((await claimResearchJob(runId, k)) ? k : null)))).filter(Boolean) as ResearchKind[];
    await Promise.all(
      claimed.map(async (kind) => {
        try {
          const r = await runResearch(kind, plan, lang);
          await setResearchJob(runId, kind, r.data ? "done" : "failed", { data: r.data, sources: r.sources }, r.data ? undefined : "no data");
        } catch (err) {
          researchFailedLog(kind, err);
          await setResearchJob(runId, kind, "failed", undefined, "error");
        }
      })
    );
    return { more: true, error: claimed.length ? undefined : "busy" };
  }

  // 2) Then the sequential steps, one per request.
  for (const step of spec.then) {
    const job = jobOf(jobs, step);
    if (job?.status === "done") continue;
    if (job?.status === "failed") return { more: false, error: "failed" };
    if (!(await claimResearchJob(runId, step))) return { more: true, error: "busy" };
    try {
      await runStep(step, businessId, jobs, lang);
      await setResearchJob(runId, step, "done");
      // One unit = one research delivered (its proposal or its 3 ideas). The
      // cost of a retried step stays in the total, so the average is real.
      if (step === "guard") await countAiUnit("brain_research");
      if (step === "ideas_pick") await countAiUnit("brain_ideas");
    } catch (err) {
      researchFailedLog(step, err);
      await setResearchJob(runId, step, "failed", undefined, "error");
      return { more: false, error: "failed" };
    }
    return { more: true };
  }
  return { more: false };
}

function resultOf(jobs: ResearchJobRow[], kind: string): { data: Record<string, unknown> | null; sources: PlanSource[] } {
  const r = (jobOf(jobs, kind)?.result ?? {}) as { data?: Record<string, unknown> | null; sources?: PlanSource[] };
  return { data: jobOf(jobs, kind)?.status === "done" ? r.data ?? null : null, sources: r.sources ?? [] };
}

async function runStep(step: string, businessId: string, jobs: ResearchJobRow[], lang: Lang) {
  const b = (await getBusinessById(businessId))!;
  let plan = b.plan;
  const es = lang === "es";

  if (step === "ideas_pick") {
    const researched = parseIdeas(resultOf(jobs, "ideas").data?.ideas);
    const { ideas, message } = researched.length ? await pickIdeas(plan, researched, lang) : { ideas: [], message: "" };
    if (ideas.length === 0) {
      // Retry re-queues only failed jobs: the search itself is marked failed
      // too, so "Reintentar" looks for new ideas instead of re-picking from the
      // same ones (all rejected or off-limits) forever.
      await setResearchJob(plan.runId, "ideas", "failed", undefined, "no usable ideas");
      throw new Error("no ideas picked");
    }
    plan = { ...plan, ideas, chosenIdea: null, stage: "choose", ownIdea: "" };
    await savePlan(businessId, plan);
    await addChatMessage(
      businessId,
      "plan",
      "ai",
      `${
        message ||
        (plan.ideaRounds > 0
          ? es
            ? `Encontré ${ideas.length} opciones nuevas, distintas a las anteriores. Escoge la que más te guste, o dime qué no te convence.`
            : `I found ${ideas.length} new options, different from the ones before. Pick the one you like, or tell me what doesn't convince you.`
          : es
            ? `Encontré ${ideas.length} opciones para ti. Escoge la que más te guste, o dime qué no te convence.`
            : `I found ${ideas.length} options for you. Pick the one you like, or tell me what doesn't convince you.`)
      }\n\n${IDEAS_TOKEN}`
    );
    return;
  }

  if (step === "strategy") {
    // Put the research together first, so the screen can show it.
    const prices = resultOf(jobs, "prices");
    const comp = resultOf(jobs, "competitors");
    const req = resultOf(jobs, "requirements");
    const faq = resultOf(jobs, "faq");
    const all = [prices, comp, req, faq];
    const market = parseMarket({
      prices: prices.data,
      examples: prices.data?.examples,
      competitors: comp.data?.competitors,
      gaps: comp.data?.gaps,
      requirements: req.data?.requirements,
      faq: faq.data?.faq,
      sources: all.flatMap((r) => r.sources),
      researchedAt: today(plan.profile.state, plan.profile.country),
      incomplete: (["prices", "competitors", "requirements", "faq"] as const).filter((k) => jobOf(jobs, k)?.status !== "done"),
    });
    plan = { ...plan, market, fears: str(faq.data?.fears) || plan.fears };
    await savePlan(businessId, plan);
    const proposal = await proposePlan(plan, lang);
    const { message, ...fields } = proposal;
    plan = { ...plan, ...fields, approvals: {}, noOffer: false };
    await savePlan(businessId, plan);
    await setResearchJob(plan.runId, "strategy", "running", { message });
    return;
  }

  if (step === "guard") {
    // The review is silent: the Guardian's notes and the code checks go back
    // to the Strategist, never to the owner. What code can fix by itself (a
    // discount nobody asked for, an invented price, a language nobody said,
    // "your costs") is fixed by code and costs no wait; only what is left
    // goes back for ONE correction round (two rounds made the owner wait
    // several minutes more).
    // The whole step runs in one request the host stops at 300 s: the review,
    // and the correction only with the time that is left (never a second review:
    // the code checks run on the result anyway).
    const stepStart = Date.now();
    const guard = await guardPlan(plan, lang);
    // Packages as the Strategist first wrote them: if the review changes them,
    // its first summary (with the old names and prices) can't be shown.
    const firstPackages = JSON.stringify(plan.packages.map((k) => [k.name, k.price]));
    // A price the owner gave in the chat is theirs even if the profile kept it
    // in other words.
    const said = (await listChatMessages(businessId, "plan")).filter((m) => m.role === "user").map((m) => m.content).join("\n");
    const byCode = (p: BusinessPlan) => withoutAvoided(noFakeCosts(noLanguageClaims(dropUnbackedRefs(markReferencePrices(p.profile.offerWanted ? p : withoutDiscounts(p), said)))));
    {
      const kept = keptPriceIssue(plan, lang);
      const hard = [...guard.block, ...silentProposalIssues(byCode(plan)), ...(kept ? [kept] : [])];
      if (hard.length) {
        const sacred = avoidedIssue(plan);
        const issues = [...new Set([...guard.block, ...silentProposalIssues(plan), ...unbackedRefIssues(plan, said), ...(kept ? [kept] : []), ...(sacred ? [sacred] : [])])];
        const left = 275_000 - (Date.now() - stepStart);
        if (left >= 60_000) {
          try {
            const fixed = await proposePlan(plan, lang, issues, Math.min(200_000, left));
            const { message: _m, ...fields } = fixed;
            plan = { ...plan, ...fields };
          } catch (err) {
            // No correction in time: the first proposal goes on, fixed by code.
            console.warn("[brain] correction skipped", businessId, (err as { message?: string })?.message);
          }
        }
      }
    }
    // Last resort, by code: a discount nobody asked for never reaches the
    // owner; a researched number is a market reference, never "your price"; a
    // price nobody gave and nobody found is not shown; no language the owner
    // never said; "your costs" only exist if the owner gave them.
    plan = byCode(plan);
    const left = [...guard.block, ...silentProposalIssues(plan)];
    if (left.length) console.warn("[brain] proposal shown with open review notes (kept internal)", businessId, left.slice(0, 6));
    // Only plain "keep in mind" notes reach the owner; review notes never do.
    plan = { ...plan, guard: { block: [], warn: guard.warn.filter((w) => !hasJargon(w, true)) }, stage: "proposal", approvals: {} };
    await savePlan(businessId, plan);
    // A business type the owner already has stays (the proposal's service title
    // is long); new projects take the short service name.
    await updateBusinessDetails(businessId, {
      category: b.category?.trim() ? b.category : (plan.profile.mainService || plan.service).slice(0, 60).replace(/^\p{Ll}/u, (c) => c.toUpperCase()),
      city: b.city || plan.profile.city || null,
    });
    // The summary is written from the FINAL proposal: the Strategist's first
    // message is used only if every amount in it is still true.
    const strategyMsg = ((jobOf(jobs, "strategy")?.result ?? {}) as { message?: string }).message || "";
    const known = knownAmounts(plan);
    const stale = moneyAmounts(strategyMsg).some((n) => !known.has(n));
    const range = marketRangeText(plan.market.prices, lang);
    // Real prices with a name say more than a range ("Vélez: $159.900").
    const named = (plan.market.examples ?? []).slice(0, 3).map((e) => `${e.who}${e.what ? ` (${e.what})` : ""}: ${e.price}`).join("; ");
    const found = named
      ? es ? `Precios reales que encontré: ${named}. ` : `Real prices I found: ${named}. `
      : range
        ? es ? `En el mercado se cobra ${range}. ` : `The market charges ${range}. `
        : "";
    const list = plan.packages
      .filter((k) => k.name && k.price)
      .map((k) => (k.ref ? `${k.name} (${es ? "referencia de mercado" : "market reference"}: ${k.price})` : `${k.name} (${k.price})`))
      .join(", ");
    const anyRef = plan.packages.some((k) => k.ref);
    const samePackages = JSON.stringify(plan.packages.map((k) => [k.name, k.price])) === firstPackages;
    const base =
      strategyMsg && !anyRef && samePackages && !stale && !hasJargon(strategyMsg, true) && !/\$\s?\d[\d,]*\s*[–-]\s*\$/.test(strategyMsg) && (plan.profile.offerWanted || !mentionsDiscount(strategyMsg))
        ? strategyMsg
        : es
          ? `Listo: investigué tu zona y armé ${plan.mode === "existing" ? "tu plan para conseguir más clientes" : "tu propuesta"}. ${found}${list ? (plan.mode === "existing" ? `Tus servicios quedan así: ${list}.` : `Te propongo estos paquetes: ${list}.`) : ""}`.trim()
          : `Done: I researched your area and built ${plan.mode === "existing" ? "your plan to get more clients" : "your proposal"}. ${found}${list ? (plan.mode === "existing" ? `Your services: ${list}.` : `I propose these packages: ${list}.`) : ""}`.trim();
    const walk = oneConfirmation(plan)
      ? ""
      : es
        ? "\n\nTe la muestro aquí mismo, parte por parte. En cada una me dices si va así o qué cambio."
        : "\n\nI'll show it to you right here, part by part. For each one, tell me if it's right or what to change.";
    // The research shows right here in the chat, as a card that opens in place.
    await addChatMessage(businessId, "plan", "ai", `${base}${walk}${plan.market.researchedAt ? `\n\n${MARKET_TOKEN}` : ""}`);
    const first = nextPartMessage(plan, lang);
    if (first) await addChatMessage(businessId, "plan", "ai", first);
    return;
  }
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim().slice(0, 240) : "";
}

export async function pipelineStatus(businessId: string) {
  const jobs = await latestResearchRun(businessId);
  return jobs.map((j) => ({ kind: j.kind, status: j.status }));
}
