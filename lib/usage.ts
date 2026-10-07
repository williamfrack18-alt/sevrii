import { AsyncLocalStorage } from "node:async_hooks";
import { addAiUsage, getAiSpendMicros } from "./db";
import { allow } from "./guard";
import { limitsForUserId } from "./billing";
import type { PlanLimits } from "./plans";

// What each AI call really costs, per account, per calendar month.
// Prices in USD per million tokens (platform.claude.com/docs/en/about-claude/pricing).
// Keep this table in sync when models or prices change.
const PRICES: { match: RegExp; input: number; output: number; cacheWrite: number; cacheRead: number }[] = [
  { match: /opus/, input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  { match: /sonnet/, input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  { match: /haiku/, input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
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
export async function researchGate(userId: string, limits?: PlanLimits): Promise<GateReason | null> {
  const l = limits ?? (await limitsForUserId(userId));
  if ((await monthSpendUsd(userId)) >= l.aiBudgetUsd) return "budget";
  if (!(await allow(`brain:run:u:${userId}:${month()}`, l.researchPerMonth, 32 * 24 * 60 * 60))) return "month";
  return null;
}

export function gateMessage(reason: GateReason, t: { aiSlowDown: string; aiDailyLimit: string; aiMonthlyLimit: string }): string {
  return reason === "slow" ? t.aiSlowDown : reason === "day" ? t.aiDailyLimit : t.aiMonthlyLimit;
}
