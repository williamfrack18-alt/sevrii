import Anthropic from "@anthropic-ai/sdk";
import { recordAiUsage } from "./usage";

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
  return metered(new Anthropic({ apiKey, maxRetries: 2, timeout: timeoutMs }));
}

// The service agents' chat with customers runs on Meta's Muse Spark, through
// its Anthropic-compatible Messages API (dev.meta.ai/docs/protocols/messages).
// The model is fixed here on purpose. MODEL_API_KEY is set in Vercel; our
// Anthropic key is never sent there (apiKey: null).
export const AGENT_MODEL = "muse-spark-1.3";
export function getAgentModel(timeoutMs = 60_000): Anthropic | null {
  const token = process.env.MODEL_API_KEY;
  if (!token) return null;
  return metered(new Anthropic({ baseURL: "https://api.meta.ai", apiKey: null, authToken: token, maxRetries: 2, timeout: timeoutMs }));
}

function metered(client: Anthropic): Anthropic {
  // Charge every call to the account being served (see lib/usage.ts).
  const create = client.messages.create.bind(client.messages);
  client.messages.create = (async (body: Parameters<typeof create>[0], opts?: Parameters<typeof create>[1]) => {
    const res = await create(body, opts);
    const usage = (res as { usage?: Parameters<typeof recordAiUsage>[1] }).usage;
    await recordAiUsage(String((body as { model?: string }).model ?? ""), usage);
    return res;
  }) as unknown as typeof client.messages.create;
  return client;
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
  // Out of credit: the admins hear about it right away.
  void import("./usage").then((m) => m.noteAiFailure(err)).catch(() => {});
}

export type AiFailure = "credits" | "busy" | "other";
export function aiFailure(err: unknown): AiFailure {
  const e = err as { status?: number; message?: string };
  const m = String(e?.message ?? err);
  if (/credit balance|usage limits|spend limit|billing/i.test(m)) return "credits";
  if (e?.status === 429 || e?.status === 529 || e?.status === 503 || /overloaded|rate limit|timed? ?out|timeout/i.test(m)) return "busy";
  return "other";
}

// What the owner reads when the AI fails: what happened and what to do, in
// plain words. Never the provider's error, JSON or request ids.
export function aiErrorReply(err: unknown, lang: "es" | "en"): string {
  const kind = aiFailure(err);
  const es = lang !== "en";
  if (kind === "credits")
    return es
      ? "El Cerebro está en pausa por un problema de nuestro lado (no es nada que hayas hecho). Todo lo que llevas quedó guardado. Ya avisamos al equipo; vuelve a escribirme en un rato y seguimos justo donde quedamos."
      : "The Brain is paused because of a problem on our side (nothing you did). Everything so far is saved. We've already told the team; write to me again in a while and we'll pick up right where we left off.";
  if (kind === "busy")
    return es
      ? "Hay mucha demanda en este momento y no alcancé a responderte. Lo que me dijiste quedó guardado: envíame el mismo mensaje otra vez en un minuto."
      : "It's very busy right now and I couldn't answer in time. What you told me is saved: send me the same message again in a minute.";
  return es
    ? "No pude terminar eso por un error de mi lado. Lo que ya me habías dicho sigue guardado. Envíame el mismo mensaje otra vez; si vuelve a pasar, escríbenos a soporte y lo revisamos."
    : "I couldn't finish that because of an error on my side. What you'd told me is still saved. Send me the same message again; if it happens again, contact support and we'll look into it.";
}
