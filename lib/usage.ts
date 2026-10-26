import { AsyncLocalStorage } from "node:async_hooks";
import { addAiUsage, getAiSpendMicros, peekRateCounter } from "./db";
import { allow } from "./guard";
import { limitsForUserId } from "./billing";
import { PLANS, PLAN_ORDER, type PlanLimits } from "./plans";

// What each AI call really costs, per account, per calendar month.
// Prices in USD per million tokens (platform.claude.com/docs/en/about-claude/pricing).
// Keep this table in sync when models or prices change.
const PRICES: { match: RegExp; input: number; output: number; cacheWrite: number; cacheRead: number }[] = [
  { match: /opus/, input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  { match: /sonnet/, input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  { match: /haiku/, input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
  // Meta Muse Spark (service agents' chat), dev.meta.ai/models/muse-spark.
  { match: /muse-spark/, input: 1.25, output: 4.25, cacheWrite: 1.25, cacheRead: 0.15 },
];
const WEB_SEARCH_USD = 0.01; // $10 per 1,000 searches

type Usage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  server_tool_use?: { web_search_requests?: number | null } | null;
};

export function costUsd(model: string, u: Usage | undefined | null): number {
  if (!u) return 0;
  const p = PRICES.find((x) => x.match.test(model)) ?? PRICES[0]; // unknown model: price it like the most expensive
  const tokens =
    ((u.input_tokens ?? 0) * p.input +
      (u.output_tokens ?? 0) * p.output +
      (u.cache_creation_input_tokens ?? 0) * p.cacheWrite +
      (u.cache_read_input_tokens ?? 0) * p.cacheRead) /
    1_000_000;
  return tokens + (u.server_tool_use?.web_search_requests ?? 0) * WEB_SEARCH_USD;
}

// The account the current request is working for, so every AI call made while
// handling it is charged to that account (set once at each entry point).
const store = new AsyncLocalStorage<{ userId: string }>();

export function runForUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  return store.run({ userId }, fn);
}

export function month(d = new Date()): string {
  return d.toISOString().slice(0, 7); // YYYY-MM (UTC)
}

export async function recordAiUsage(model: string, usage: Usage | undefined | null): Promise<void> {
  const userId = store.getStore()?.userId;
  const usd = costUsd(model, usage);
  if (!userId) {
    if (usd > 0) console.warn("[usage] AI call without an account", model, usd.toFixed(4));
    return;
  }
  try {
    await addAiUsage(userId, month(), Math.round(usd * 1_000_000));
  } catch (err) {
    console.error("[usage] could not record", err);
  }
}

export async function monthSpendUsd(userId: string): Promise<number> {
  try {
    return (await getAiSpendMicros(userId, month())) / 1_000_000;
  } catch {
    return 0;
  }
}

export type GateReason = "slow" | "day" | "month" | "budget";

// One check before any AI chat message. Order: burst, day, month, money.
export async function chatGate(userId: string, limits?: PlanLimits): Promise<GateReason | null> {
  const l = limits ?? (await limitsForUserId(userId));
  if (!(await allow(`ai:min:u:${userId}`, 10, 60))) return "slow";
  if (!(await allow(`ai:day:u:${userId}`, l.aiPerDay, 24 * 60 * 60))) return "day";
  if (!(await allow(`ai:month:u:${userId}:${month()}`, l.aiPerMonth, 32 * 24 * 60 * 60))) return "month";
  if ((await monthSpendUsd(userId)) >= l.aiBudgetUsd) return "budget";
  return null;
}

// One check before starting a Brain research run (the expensive part).
// budgetOnly: "show me other ideas" rounds don't use up a research run; they
// still count toward the AI budget (and are capped per project in the plan).
export async function researchGate(userId: string, limits?: PlanLimits, opts: { budgetOnly?: boolean } = {}): Promise<GateReason | null> {
  const l = limits ?? (await limitsForUserId(userId));
  if ((await monthSpendUsd(userId)) >= l.aiBudgetUsd) return "budget";
  if (opts.budgetOnly) return null;
  if (!(await allow(`brain:run:u:${userId}:${month()}`, l.researchPerMonth, 32 * 24 * 60 * 60))) return "month";
  return null;
}

// Customers chatting on an owner's page spend their own pot, not the owner's:
// a stranger (or a script) can never use up the owner's AI for Plan/Store/Brain.
// The pot is a share of the plan's budget, tracked under its own key.
export const VISITOR_AI_SHARE = 0.4;
export function visitorAiAccount(ownerId: string): string {
  return `visitors:${ownerId}`;
}
export async function visitorAiGate(ownerId: string): Promise<boolean> {
  const l = await limitsForUserId(ownerId);
  return (await monthSpendUsd(visitorAiAccount(ownerId))) < Math.max(1, l.aiBudgetUsd * VISITOR_AI_SHARE);
}

// Would a research run start right now? Same rules as researchGate, but it
// uses nothing up: checked BEFORE moving the plan to a research stage, so an
// owner over the limit is told so instead of getting stuck "researching".
export async function researchWouldStart(userId: string, opts: { budgetOnly?: boolean } = {}): Promise<boolean> {
  const l = await limitsForUserId(userId);
  if ((await monthSpendUsd(userId)) >= l.aiBudgetUsd) return false;
  if (opts.budgetOnly) return true;
  try {
    return (await peekRateCounter(`brain:run:u:${userId}:${month()}`)) < l.researchPerMonth;
  } catch {
    return true;
  }
}

// What the owner has used of this month's research, for an honest message
// when research can't start: real numbers, and "upgrade" only when a higher
// plan exists and can be bought today.
export type ResearchUsage = { used: number; limit: number; budgetHit: boolean; canUpgrade: boolean; resetsOn: string };
export async function researchUsage(userId: string): Promise<ResearchUsage> {
  const l = await limitsForUserId(userId);
  let used = 0;
  try {
    used = await peekRateCounter(`brain:run:u:${userId}:${month()}`);
  } catch {}
  const budgetHit = (await monthSpendUsd(userId)) >= l.aiBudgetUsd;
  const canUpgrade = PLAN_ORDER.some((id) => PLANS[id].available && PLANS[id].limits.researchPerMonth > l.researchPerMonth);
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { used: Math.min(used, l.researchPerMonth), limit: l.researchPerMonth, budgetHit, canUpgrade, resetsOn: next.toISOString().slice(0, 10) };
}

export function researchLimitText(u: ResearchUsage, lang: "es" | "en"): string {
  const d = new Date(`${u.resetsOn}T12:00:00Z`);
  const day = d.toLocaleDateString(lang === "es" ? "es-US" : "en-US", { day: "numeric", month: "long", timeZone: "UTC" });
  if (lang === "es") {
    const what = u.budgetHit && u.used < u.limit ? "Este mes ya usaste todo el presupuesto de IA de tu plan" : `Este mes ya usaste ${u.used} de ${u.limit} investigaciones de tu plan`;
    return u.canUpgrade
      ? `${what}. Todo quedó guardado: puedes mejorar tu plan en Planes para seguir ahora, o seguir el ${day} justo donde lo dejaste.`
      : `${what}. Todo quedó guardado: tu plan se renueva el ${day} y sigues justo donde lo dejaste.`;
  }
  const what = u.budgetHit && u.used < u.limit ? "This month you've used your plan's whole AI budget" : `This month you've used ${u.used} of ${u.limit} research runs in your plan`;
  return u.canUpgrade
    ? `${what}. Everything is saved: upgrade in Plans to keep going now, or continue on ${day} right where you left off.`
    : `${what}. Everything is saved: your plan renews on ${day} and you continue right where you left off.`;
}

export function gateMessage(reason: GateReason, t: { aiSlowDown: string; aiDailyLimit: string; aiMonthlyLimit: string }): string {
  return reason === "slow" ? t.aiSlowDown : reason === "day" ? t.aiDailyLimit : t.aiMonthlyLimit;
}

// A service agent's work for customers has its own pot (customers paid the
// owner for it): as big as the plan's whole AI budget, separate from the
// owner's own use and from the page assistant's.
export function serviceAgentAccount(ownerId: string): string {
  return `agentsvc:${ownerId}`;
}
export async function serviceAgentGate(ownerId: string): Promise<boolean> {
  const l = await limitsForUserId(ownerId);
  return (await monthSpendUsd(serviceAgentAccount(ownerId))) < Math.max(2, l.aiBudgetUsd);
}
