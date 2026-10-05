import Anthropic from "@anthropic-ai/sdk";

// claude-sonnet-4-5 was deprecated on 2026-09-30 and is retired on
// 2026-11-30, so the default is its replacement. ANTHROPIC_MODEL can still
// override it from Vercel.
export const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";

// Brain roles use the model that fits each job (see the Fase 1 design doc).
// Each can be overridden from Vercel without a deploy.
export const MODELS = {
  chat: process.env.SEVRII_MODEL_CHAT || MODEL, // Interviewer: fast, natural Spanish
  research: process.env.SEVRII_MODEL_RESEARCH || MODEL, // Researcher: web search + read
  strategy: process.env.SEVRII_MODEL_STRATEGY || "claude-opus-5-5", // Strategist: prices and ideas
  guard: process.env.SEVRII_MODEL_GUARD || "claude-haiku-4-5", // Guardian: rule checks
};

export function getClaude(timeoutMs = 45_000): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return new Anthropic({ apiKey, maxRetries: 2, timeout: timeoutMs });
}

// Sonnet 5.5 thinks by default and counts thinking inside max_tokens. These
// chats are short, well-specified tool calls, so keep thinking to the minimum
// ("between_tools") at low effort — faster and cheaper.
export const CHAT_SETTINGS = {
  thinking: { type: "between_tools" },
  output_config: { effort: "low" },
} as const;

// Log the real error for us; never show provider details to the customer.
export function logAiError(where: string, err: unknown): void {
  const e = err as { status?: number; message?: string; error?: unknown };
  console.error(`[ai:${where}]`, e?.status ?? "", e?.message ?? String(err));
}
