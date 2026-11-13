import type Anthropic from "@anthropic-ai/sdk";
import type { ContentBlock, MessageCreateParamsNonStreaming, MessageParam, ToolUnion } from "@anthropic-ai/sdk/resources/messages";
import type { PlanSource } from "../plan";

// The owner's date, not UTC: at 9 p.m. in Miami it's still "today" there.
const CENTRAL = new Set("AL AR IL IA KS LA MN MS MO NE ND OK SD TN TX WI".split(" "));
const MOUNTAIN = new Set("AZ CO ID MT NM UT WY".split(" "));
const PACIFIC = new Set("CA NV OR WA".split(" "));
// Outside the US, the country's main time zone (the date only has to be right
// for offers' end dates and research dates).
const COUNTRY_ZONE: Record<string, string> = {
  MX: "America/Mexico_City", CO: "America/Bogota", ES: "Europe/Madrid", AR: "America/Argentina/Buenos_Aires", PE: "America/Lima",
  CL: "America/Santiago", VE: "America/Caracas", EC: "America/Guayaquil", BO: "America/La_Paz", PY: "America/Asuncion",
  UY: "America/Montevideo", DO: "America/Santo_Domingo", GT: "America/Guatemala", SV: "America/El_Salvador", HN: "America/Tegucigalpa",
  NI: "America/Managua", CR: "America/Costa_Rica", PA: "America/Panama", CU: "America/Havana", PR: "America/Puerto_Rico",
  CA: "America/Toronto", BR: "America/Sao_Paulo", GB: "Europe/London", IE: "Europe/Dublin", PT: "Europe/Lisbon", FR: "Europe/Paris",
  DE: "Europe/Berlin", IT: "Europe/Rome", NL: "Europe/Amsterdam", BE: "Europe/Brussels", CH: "Europe/Zurich", AU: "Australia/Sydney",
};
export function zoneOf(state = "", country = ""): string {
  const c = country.toUpperCase();
  if (c && c !== "US" && COUNTRY_ZONE[c]) return COUNTRY_ZONE[c];
  if (c && c !== "US") return "UTC";
  const st = state.toUpperCase();
  if (st === "AZ") return "America/Phoenix";
  if (st === "HI") return "Pacific/Honolulu";
  if (st === "AK") return "America/Anchorage";
  if (st === "PR") return "America/Puerto_Rico";
  if (CENTRAL.has(st)) return "America/Chicago";
  if (MOUNTAIN.has(st)) return "America/Denver";
  if (PACIFIC.has(st)) return "America/Los_Angeles";
  return "America/New_York";
}
export function today(state = "", country = ""): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: zoneOf(state, country), year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
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

// "&ndash;", "&#8211;", "&ntilde;" in titles and descriptions of pages.
const NAMED: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", ntilde: "ñ", Ntilde: "Ñ", aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú", uuml: "ü", iexcl: "¡", iquest: "¿" };
export function decodeEntities(t: string): string {
  return t.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return NAMED[e] ?? NAMED[e.toLowerCase()] ?? m;
  });
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


async function openPage(url: string): Promise<{ title: string; description: string } | null> {
  const { lookup } = await import("node:dns/promises");
  let cur = url;
  for (let hop = 0; hop < 4; hop++) {
    let u: URL;
    try {
      u = new URL(cur);
    } catch {
      return null;
    }
    if (!/^https?:$/.test(u.protocol) || PRIVATE_HOST.test(u.hostname)) return null;
    // The name must resolve to a public address.
    const addrs = await lookup(u.hostname, { all: true }).catch(() => []);
    if (!addrs.length || addrs.some((a) => PRIVATE_HOST.test(a.address))) return null;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 6000);
    try {
      const res = await fetch(u, { redirect: "manual", signal: ctl.signal, headers: { "user-agent": "Mozilla/5.0 (compatible; SevriiBot/1.0)", accept: "text/html,*/*;q=0.5" } });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        cur = new URL(res.headers.get("location")!, u).toString();
        continue;
      }
      // Blocked for bots (401/403/429) still means the page exists; 404/410/5xx do not.
      if (res.status === 401 || res.status === 403 || res.status === 429) return { title: u.hostname.replace(/^www\./, ""), description: "" };
      if (!res.ok) return null;
      const reader = res.body?.getReader();
      let html = "";
      if (reader) {
        const dec = new TextDecoder();
        while (html.length < 150_000) {
          const { done, value } = await reader.read();
          if (done) break;
          html += dec.decode(value, { stream: true });
          if (/<\/head>/i.test(html)) break;
        }
        reader.cancel().catch(() => {});
      }
      const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "";
      const desc = /<meta[^>]+(?:name|property)=["'](?:og:)?description["'][^>]*content=["']([^"']*)["']/i.exec(html)?.[1] ?? /<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["'](?:og:)?description["']/i.exec(html)?.[1] ?? "";
      const clean = (x: string) => x.replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
      return { title: clean(title).slice(0, 120) || u.hostname.replace(/^www\./, ""), description: clean(desc) };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

// Every page the server tools actually returned. Sources the model writes are
// only kept if they are in this set, so it can't invent links.
//
// Meta's search does not document the shape of its results, so the collector
// is shape-agnostic: it walks every block the model returned (except its own
// reasoning) and keeps anything that looks like a page (a link with a title,
// a description or a snippet). Links that only show up in the model's text are
// kept only after the page itself answers (see verifyFromText).
const PRIVATE_HOST = /^(localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$|\[?f[cd][0-9a-f]{2}:|\[?fe80:)/i;
const first = (...v: unknown[]) => v.find((x) => typeof x === "string" && x.trim()) as string | undefined;

export class SeenPages {
  private pages = new Map<string, PlanSource>();
  // What the search blocks looked like (types only), for the logs.
  blockTypes = new Set<string>();
  add(url: string, title?: string | null, description?: string | null) {
    const n = normUrl(url);
    if (!n || !/^https?:/i.test(n)) return;
    const desc = decodeEntities(description || "").replace(/\s+/g, " ").trim().slice(0, 300);
    title = title ? decodeEntities(title) : title;
    const cur = this.pages.get(n);
    if (!cur) this.pages.set(n, { url, title: (title || url).slice(0, 120), ...(desc ? { description: desc } : {}) });
    else if (!cur.description && desc) this.pages.set(n, { ...cur, description: desc });
  }
  // Any object with a link in it: {url,title,description|snippet|page_snippet|content|text}.
  private walk(v: unknown, depth = 0) {
    if (depth > 6 || v === null || typeof v !== "object") return;
    if (Array.isArray(v)) {
      for (const x of v) this.walk(x, depth + 1);
      return;
    }
    const o = v as Record<string, unknown>;
    if (o.type === "thinking" || o.type === "redacted_thinking") return;
    const url = first(o.url, o.link, o.source);
    if (url && /^https?:\/\//i.test(url.trim())) {
      this.add(url.trim(), first(o.title, o.name, o.page_title), first(o.description, o.snippet, o.page_snippet, o.summary, typeof o.content === "string" ? o.content : undefined, o.cited_text, o.text));
    }
    for (const k of Object.keys(o)) if (typeof o[k] === "object") this.walk(o[k], depth + 1);
  }
  collect(content: ContentBlock[]) {
    for (const c of content) {
      const t = String((c as { type?: string }).type ?? "");
      if (t !== "text" && t !== "thinking" && t !== "redacted_thinking" && t !== "tool_use") this.blockTypes.add(t);
      if (t === "text") {
        const cits = (c as { citations?: unknown }).citations;
        if (Array.isArray(cits)) this.walk(cits);
      } else if (t !== "thinking" && t !== "redacted_thinking" && t !== "tool_use" && t !== "server_tool_use") {
        this.walk(c);
      }
    }
  }
  // Pages the model names in its answer that the search blocks didn't hand us.
  // Each one is opened (public web only) and kept only if the page really
  // answers; its title and description come from the page itself.
  async verifyFromText(text: string, max = 12): Promise<void> {
    const urls = [...new Set([...text.matchAll(/https?:\/\/[^\s"'<>)\]}]+/g)].map((m) => m[0].replace(/[.,;:]+$/, "")))]
      .filter((u) => !this.has(u))
      .slice(0, max);
    await Promise.all(urls.map((u) => openPage(u).then((r) => r && this.add(u, r.title, r.description)).catch(() => {})));
  }
  has(url: string): boolean {
    return this.pages.has(normUrl(url));
  }
  // Another page of a site the search did return (a price list next to the
  // home page it found): the business is real and was seen, the exact page may differ.
  hasHost(url: string): boolean {
    const host = (u: string) => {
      try {
        return new URL(u).hostname.replace(/^www\./, "").toLowerCase();
      } catch {
        return "";
      }
    };
    const h = host(url);
    return Boolean(h) && [...this.pages.values()].some((p) => host(p.url) === h);
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
        // At most one retry: research steps share a request the host stops at 300 s.
        const res = await client.messages.create({ ...base, tools: tools.length ? tools : undefined, messages: convo }, { timeout: opts.timeoutMs, maxRetries: 1 });
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

// Ideas never proposed (whole words, accents and plurals included: "notaría",
// "trámites migratorios", "préstamos").
export const RESTRICTED = /\b(credit repair|reparaci[oó]n de cr[eé]dito|notar[ií][oa]s?|notary|notaries|immigration|inmigraci[oó]n|migratori[oa]s?|loans?|pr[eé]stamos?|medical|m[eé]dic[oa]s?)(?![\p{L}\d])/iu;
