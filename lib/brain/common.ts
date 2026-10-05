import type Anthropic from "@anthropic-ai/sdk";
import type { ContentBlock, MessageCreateParamsNonStreaming, MessageParam, ToolUnion } from "@anthropic-ai/sdk/resources/messages";
import type { PlanSource } from "../plan";

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function textOf(content: ContentBlock[]): string {
  return content
    .filter((c) => c.type === "text")
    .map((c) => (c as { text: string }).text)
    .join("")
    .trim();
}

// Pull the first JSON object out of a model reply (fenced or bare).
export function extractJson(text: string): Record<string, unknown> | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidates = [fenced?.[1], text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)].filter(Boolean) as string[];
  for (const c of candidates) {
    try {
      const v = JSON.parse(c);
      if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch {
      // try the next one
    }
  }
  return null;
}

function normUrl(u: string): string {
  try {
    const x = new URL(u);
    x.hash = "";
    return x.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

// Every page the server tools actually returned. Sources the model writes are
// only kept if they are in this set, so it can't invent links.
export class SeenPages {
  private pages = new Map<string, PlanSource>();
  add(url: string, title?: string | null) {
    const n = normUrl(url);
    if (n && /^https?:/i.test(n) && !this.pages.has(n)) this.pages.set(n, { url, title: (title || url).slice(0, 120) });
  }
  collect(content: ContentBlock[]) {
    for (const c of content) {
      if (c.type === "web_search_tool_result" && Array.isArray(c.content)) {
        for (const r of c.content) if (r.type === "web_search_result") this.add(r.url, r.title);
      } else if (c.type === "web_fetch_tool_result" && c.content && c.content.type === "web_fetch_result") {
        this.add(c.content.url, (c.content.content as { title?: string | null })?.title ?? null);
      } else if (c.type === "text" && c.citations) {
        for (const cit of c.citations) if (cit.type === "web_search_result_location") this.add(cit.url, cit.title);
      }
    }
  }
  has(url: string): boolean {
    return this.pages.has(normUrl(url));
  }
  get(url: string): PlanSource | undefined {
    return this.pages.get(normUrl(url));
  }
  all(): PlanSource[] {
    return [...this.pages.values()];
  }
  // Keep only links that were really seen; give them the seen title if the model gave none.
  filter(list: unknown, max: number): PlanSource[] {
    const out: PlanSource[] = [];
    for (const x of Array.isArray(list) ? list : []) {
      const url = typeof x === "string" ? x : String((x as { url?: unknown })?.url ?? "");
      const seen = this.get(url);
      if (seen && !out.some((o) => o.url === seen.url)) out.push(seen);
      if (out.length >= max) break;
    }
    return out;
  }
}

function isToolRejected(err: unknown): boolean {
  return (err as { status?: number })?.status === 400;
}

// Run one request with Anthropic-hosted tools (web search / fetch), following
// pause_turn until the model is done. Falls back to fewer tools if the
// organization hasn't enabled them (the API answers 400).
export async function runWithServerTools(
  client: Anthropic,
  base: Omit<MessageCreateParamsNonStreaming, "tools" | "messages">,
  messages: MessageParam[],
  toolSets: ToolUnion[][],
  opts: { timeoutMs: number; seen: SeenPages }
): Promise<{ text: string; usedTools: boolean }> {
  let lastErr: unknown = null;
  for (const tools of toolSets) {
    const convo = [...messages];
    try {
      let text = "";
      for (let step = 0; step < 8; step++) {
        const res = await client.messages.create({ ...base, tools: tools.length ? tools : undefined, messages: convo }, { timeout: opts.timeoutMs });
        opts.seen.collect(res.content);
        const t = textOf(res.content);
        if (t) text = t;
        if (res.stop_reason !== "pause_turn") break;
        convo.push({ role: "assistant", content: res.content });
      }
      return { text, usedTools: tools.length > 0 };
    } catch (err) {
      lastErr = err;
      if (!isToolRejected(err)) throw err;
      console.warn("[brain] tools rejected, retrying with fewer:", (err as { message?: string })?.message);
    }
  }
  throw lastErr ?? new Error("no tool set worked");
}

export const RESTRICTED = /\b(credit repair|reparaci[oó]n de cr[eé]dito|notari[oa]|immigration|inmigraci[oó]n|migratori[oa]|loans?|pr[eé]stamos?|medical|m[eé]dic[oa])\b/i;
