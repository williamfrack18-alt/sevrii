import {
  addChatMessage,
  claimResearchJob,
  createResearchRun,
  getBusinessById,
  latestResearchRun,
  requeueFailedJobs,
  setResearchJob,
  updateBusinessDetails,
  updateBusinessPlan,
  type ResearchJobRow,
} from "../db";
import type { Lang } from "../i18n";
import { allow } from "../guard";
import { limitsForUserId } from "../billing";
import { parseIdeas, parseMarket, parsePlan, type BusinessPlan, type PlanStage } from "../plan";
import { runResearch, researchFailedLog, type ResearchKind } from "./research";
import { pickIdeas, proposePlan } from "./strategist";
import { guardPlan } from "./guard";
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

// Research runs per account per day come from the plan; SEVRII_RESEARCH_PER_DAY overrides for everyone.
const RUNS_OVERRIDE = Number(process.env.SEVRII_RESEARCH_PER_DAY || 0);

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
  let plan = b.plan;
  if (plan.stage !== "ideas_research" && plan.stage !== "research") return { more: false };
  const spec = STEPS[plan.stage];

  let jobs = await latestResearchRun(businessId);
  if (!plan.runId || jobs.length === 0 || jobs[0].runId !== plan.runId) {
    const perDay = RUNS_OVERRIDE || (await limitsForUserId(userId)).researchPerDay;
    if (!(await allow(`brain:run:u:${userId}`, perDay, 24 * 60 * 60))) return { more: false, error: "limit" };
    const runId = await createResearchRun(businessId, [...spec.parallel, ...spec.then]);
    plan = { ...plan, runId };
    await savePlan(businessId, plan);
    jobs = await latestResearchRun(businessId);
  } else if (retry) {
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
    } catch (err) {
      researchFailedLog(step, err);
      await setResearchJob(runId, step, "failed", undefined, "error");
      return { more: false, error: "failed" };
    }
    return { more: true };
  }
  return { more: false };
}

function resultOf(jobs: ResearchJobRow[], kind: string): { data: Record<string, unknown> | null; sources: { title: string; url: string }[] } {
  const r = (jobOf(jobs, kind)?.result ?? {}) as { data?: Record<string, unknown> | null; sources?: { title: string; url: string }[] };
  return { data: jobOf(jobs, kind)?.status === "done" ? r.data ?? null : null, sources: r.sources ?? [] };
}

async function runStep(step: string, businessId: string, jobs: ResearchJobRow[], lang: Lang) {
  const b = (await getBusinessById(businessId))!;
  let plan = b.plan;
  const es = lang === "es";

  if (step === "ideas_pick") {
    const researched = parseIdeas(resultOf(jobs, "ideas").data?.ideas);
    if (researched.length === 0) throw new Error("no ideas researched");
    const { ideas, message } = await pickIdeas(plan, researched, lang);
    if (ideas.length === 0) throw new Error("no ideas picked");
    plan = { ...plan, ideas, chosenIdea: null, stage: "choose" };
    await savePlan(businessId, plan);
    await addChatMessage(businessId, "plan", "ai", message || (es ? "Encontré 3 opciones para ti. Míralas abajo y escoge la que más te guste." : "I found 3 options for you. See them below and pick one."));
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
      competitors: comp.data?.competitors,
      gaps: comp.data?.gaps,
      requirements: req.data?.requirements,
      faq: faq.data?.faq,
      sources: all.flatMap((r) => r.sources),
      researchedAt: today(),
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
    let guard = await guardPlan(plan, lang);
    if (guard.block.length) {
      // One correction round, then show whatever remains to the owner.
      const fixed = await proposePlan(plan, lang, guard.block);
      const { message: _m, ...fields } = fixed;
      plan = { ...plan, ...fields };
      guard = await guardPlan(plan, lang);
    }
    plan = { ...plan, guard, stage: "proposal", approvals: {} };
    await savePlan(businessId, plan);
    await updateBusinessDetails(businessId, { category: plan.service.slice(0, 60) || b.category, city: plan.profile.city || b.city });
    const strategyMsg = ((jobOf(jobs, "strategy")?.result ?? {}) as { message?: string }).message;
    const base =
      strategyMsg ||
      (es ? "Listo: investigué tu zona y armé tu propuesta. Revísala abajo, bloque por bloque." : "Done: I researched your area and built your proposal. Review it below, block by block.");
    const note = guard.block.length
      ? es
        ? `\n\nAntes de aprobar, revisa esto: ${guard.block.join(" ")}`
        : `\n\nBefore approving, check this: ${guard.block.join(" ")}`
      : "";
    await addChatMessage(businessId, "plan", "ai", base + note);
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
