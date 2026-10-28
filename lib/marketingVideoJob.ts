import "server-only";
// The cloud browser (Browserbase) makes an approved marketing video: it opens
// the AI video tool, writes the approved prompt, generates, and saves the real
// file. The owner signs in and pays (if the tool asks) in the live view: the
// agent never types or keeps their credentials, never buys anything, stops at
// any CAPTCHA, and never reports a video it didn't actually get.

import { put } from "@vercel/blob";
import { inflateRawSync } from "node:zlib";
import type { MessageParam, TextBlock, Tool, ToolResultBlockParam, ToolUseBlock } from "@anthropic-ai/sdk/resources/messages";
import { AGENT_MODEL, MODELS, getAgentModel, getClaude, logAiError } from "./claude";
import { addChatMessage, getMarketingVideo, updateMarketingVideo, type BusinessRow, type MarketingVideoRow, type VideoJob } from "./db";
import { browserDownloads, browserMode, getHands, releaseBrowser, SENSITIVE_FIELD, type BrowserState, type Hands, type PageView } from "./agentOps/browser";
import { videoToken, videoToolOf } from "./marketingVideos";

const CHANNEL = "brain";
const ROUNDS_PER_CALL = 8;
const LOCK_MS = 4 * 60 * 1000;
const MAX_BYTES = 80 * 1024 * 1024;
// Buying, subscribing or adding a card: only the owner, in the live view.
const PAY_ACTION = /(buy|purchase|subscribe|upgrade|checkout|pay\b|payment|add card|billing|get credits|buy credits|top.?up|start (free )?trial|plan\b|plans\b|pricing|comprar|suscrib|mejorar plan|pagar|pago|tarjeta|(comprar|obtener|recargar) cr[eé]ditos|prueba gratis)/i;
// Signing in: only the owner, in the live view.
const LOGIN_FIELD = /(e-?mail|correo|password|contrase|phone|tel[eé]fono|verification|verificaci[oó]n|\bcode\b|c[oó]digo|username|usuario|otp)/i;
const AUTH_HOST = /(^|\.)(accounts\.google\.com|appleid\.apple\.com|login\.|auth\.|signin\.|sso\.|id\.)/i;

function hostAllowed(url: string, hosts: string[]): boolean {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    return hosts.some((x) => h === x || h.endsWith(`.${x}`));
  } catch {
    return false;
  }
}

function view(v: PageView): string {
  const fields = v.fields.map((f) => `${f.id} | ${f.label || "(no label)"} | ${f.type}${f.options ? ` | options: ${f.options.slice(0, 20).join(" / ")}` : ""} | value: ${(f.value || "(empty)").slice(0, 120)}${f.sensitive ? " | SENSITIVE: the owner types it" : ""}`);
  const buttons = v.buttons.map((b) => `${b.id} | ${b.label}${b.kind === "link" ? " (link)" : ""}`);
  return [
    `URL: ${v.url}`,
    `Title: ${v.title}`,
    v.captcha ? "WARNING: the page shows a CAPTCHA or human check." : "",
    `Text: ${v.text.slice(0, 3000)}`,
    fields.length ? `Fields:\n${fields.join("\n")}` : "Fields: none",
    buttons.length ? `Buttons and links:\n${buttons.slice(0, 60).join("\n")}` : "Buttons: none",
  ]
    .filter(Boolean)
    .join("\n");
}

const TOOLS: Tool[] = [
  { name: "browser_open", description: "Open a page of the video tool.", input_schema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } },
  { name: "browser_read", description: "Read the current page again.", input_schema: { type: "object", properties: {} } },
  { name: "browser_fill", description: "Type in a field (by id): the video prompt, a title, an option. Never an email, password, phone, code or card.", input_schema: { type: "object", properties: { field: { type: "string" }, value: { type: "string" } }, required: ["field", "value"] } },
  { name: "browser_click", description: "Click a button or link (by id). Buying, subscribing or adding a card is the owner's (ask_customer_pay).", input_schema: { type: "object", properties: { element: { type: "string" } }, required: ["element"] } },
  { name: "wait", description: "The video is generating: wait a few seconds and read the page again.", input_schema: { type: "object", properties: { seconds: { type: "number" } }, required: ["seconds"] } },
  { name: "ask_customer_login", description: "The tool asks to sign in or create an account: the owner does it in the live view. Stops until they tap Done.", input_schema: { type: "object", properties: { why: { type: "string" } }, required: ["why"] } },
  { name: "ask_customer_pay", description: "The tool asks for a plan, credits or a card: the owner decides and pays in the live view. Say exactly what the page asks (and the price shown). Stops until they tap Done.", input_schema: { type: "object", properties: { what: { type: "string" }, price: { type: "string" } }, required: ["what"] } },
  { name: "report_blocked", description: "Something you can't get past (CAPTCHA, extra verification, an error). Stops.", input_schema: { type: "object", properties: { reason: { type: "string" }, next_step: { type: "string" } }, required: ["reason", "next_step"] } },
  { name: "step", description: "Update the progress shown to the owner (short label).", input_schema: { type: "object", properties: { label: { type: "string" }, status: { type: "string", enum: ["done", "doing", "failed"] } }, required: ["label", "status"] } },
  { name: "list_videos", description: "List the videos on the current page (index, size, source) to find the generated one.", input_schema: { type: "object", properties: {} } },
  { name: "save_video", description: "Save the generated video by its index from list_videos. Only closes the job if a real video file is obtained.", input_schema: { type: "object", properties: { index: { type: "number" } }, required: ["index"] } },
  { name: "save_download", description: "After clicking the tool's Download button: save the file the browser downloaded.", input_schema: { type: "object", properties: {} } },
  { name: "mark_failed", description: "The video can't be made with this tool (say why plainly). Stops.", input_schema: { type: "object", properties: { reason: { type: "string" } }, required: ["reason"] } },
];

function system(b: BusinessRow, v: MarketingVideoRow): string {
  const tool = videoToolOf(v.tool);
  const es = b.site.lang !== "en";
  return `You make ONE marketing video for "${b.name}" in ${tool.name} (${tool.url}), in a real cloud browser that the owner can watch live.
Approved angle: ${v.angle}
Approved prompt (use it as is; you may adapt the wording to the tool's prompt box, never the idea): ${v.prompt}
Format: vertical 9:16 if the tool lets you choose, otherwise the default. Length: the tool's default short length.

How you work:
- Open the tool, find where to create a video from text, type the prompt, choose 9:16 if offered, and click Generate/Create.
- Generating takes minutes: use wait (up to 30 s) and read again until the video is shown.
- Then list_videos and save_video for the new one. If it can't be saved that way, click the tool's Download button and save_download.
- Signing in or creating an account: ask_customer_login (the owner does it in the live view). Never type an email, password, phone or code.
- Plan, credits, card or any payment: ask_customer_pay with exactly what the page asks and its price. Never click buy, subscribe or upgrade.
- CAPTCHA or human check: report_blocked. Never try to get around it.
- Never say the video is ready unless save_video or save_download succeeded. If it truly can't be done, mark_failed with the reason.
- Keep progress updated with step (short labels in ${es ? "Spanish" : "English"}). Your text replies are short, plain, in ${es ? "Spanish" : "English"}.`;
}

// Google's own pages (Flow, sign-in) carry an invisible reCAPTCHA badge and a
// "protected by reCAPTCHA" note: that isn't a check for the owner. Only a
// challenge actually shown on screen (or its words) counts as a CAPTCHA.
const SHOWN_CAPTCHA_JS = `(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 40 && r.height > 40 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.1; };
  const frames = [...document.querySelectorAll('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="challenges.cloudflare"], iframe[src*="arkoselabs"]')].filter((f) => !/size=invisible/.test(f.src) && vis(f));
  const boxes = [...document.querySelectorAll('.g-recaptcha:not([data-size="invisible"]), .h-captcha, .cf-turnstile')].filter(vis);
  const words = /(verify you are human|verifica que eres humano|no soy un robot|i.m not a robot|are you a robot|unusual traffic|tr[aá]fico inusual|complete the security check|select all images)/i.test(document.body.innerText.slice(0, 5000));
  return frames.length + boxes.length > 0 || words;
})()`;

// Lists <video> elements (and video links) on the page, tagging them for save_video.
const VIDEO_JS = `(() => {
  const out = [];
  const seen = new Set();
  document.querySelectorAll('video').forEach((el) => {
    const src = el.currentSrc || el.src || (el.querySelector('source') && el.querySelector('source').src) || '';
    if (!src || seen.has(src)) return;
    seen.add(src);
    const r = el.getBoundingClientRect();
    el.setAttribute('data-svv', String(out.length));
    out.push({ index: out.length, src: src.slice(0, 500), w: Math.round(r.width), h: Math.round(r.height), duration: Math.round(el.duration || 0), kind: 'video' });
  });
  document.querySelectorAll('a[href]').forEach((a) => {
    const href = a.href || '';
    if (!/\\.(mp4|webm|mov)(\\?|$)/i.test(href) || seen.has(href)) return;
    seen.add(href);
    out.push({ index: out.length, src: href.slice(0, 500), w: 0, h: 0, duration: 0, kind: 'link' });
  });
  return out.slice(0, 20);
})()`;

type VideoCandidate = { index: number; src: string; w: number; h: number; duration: number; kind: string };

// A real video file: MP4/MOV ("ftyp" box) or WebM (EBML header), not a tiny placeholder.
function videoKind(buf: Buffer): { ext: string; type: string } | null {
  if (buf.length < 50_000) return null;
  if (buf.subarray(4, 8).toString("latin1") === "ftyp") {
    const brand = buf.subarray(8, 12).toString("latin1");
    return brand.startsWith("qt") ? { ext: "mov", type: "video/quicktime" } : { ext: "mp4", type: "video/mp4" };
  }
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return { ext: "webm", type: "video/webm" };
  return null;
}

// The largest video inside the Browserbase downloads zip (stored or deflated entries).
function videoFromZip(zip: Buffer): Buffer | null {
  let best: Buffer | null = null;
  let i = 0;
  while (i + 30 <= zip.length) {
    if (zip.readUInt32LE(i) !== 0x04034b50) break;
    const method = zip.readUInt16LE(i + 8);
    const flags = zip.readUInt16LE(i + 6);
    let size = zip.readUInt32LE(i + 18);
    const nameLen = zip.readUInt16LE(i + 26);
    const extraLen = zip.readUInt16LE(i + 28);
    const name = zip.subarray(i + 30, i + 30 + nameLen).toString("utf8");
    const start = i + 30 + nameLen + extraLen;
    if (flags & 0x08 || size === 0) {
      // Size comes after the data: use the central directory instead.
      return videoFromCentral(zip);
    }
    const raw = zip.subarray(start, start + size);
    if (/\.(mp4|webm|mov)$/i.test(name)) {
      try {
        const data = method === 0 ? Buffer.from(raw) : method === 8 ? inflateRawSync(raw) : null;
        if (data && videoKind(data) && (!best || data.length > best.length)) best = data;
      } catch {
        // skip a broken entry
      }
    }
    i = start + size;
  }
  return best;
}

function videoFromCentral(zip: Buffer): Buffer | null {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) return null;
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  let best: Buffer | null = null;
  for (let n = 0; n < count && p + 46 <= zip.length; n++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) break;
    const method = zip.readUInt16LE(p + 10);
    const size = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const name = zip.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    if (/\.(mp4|webm|mov)$/i.test(name) && local + 30 <= zip.length) {
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const raw = zip.subarray(start, start + size);
      try {
        const data = method === 0 ? Buffer.from(raw) : method === 8 ? inflateRawSync(raw) : null;
        if (data && videoKind(data) && (!best || data.length > best.length)) best = data;
      } catch {
        // skip
      }
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return best;
}

// Reads a video the page shows: a normal URL is fetched directly; a blob: URL
// is read inside the page (the file only exists there) in base64 pieces.
async function grabVideo(hands: Hands, c: VideoCandidate): Promise<Buffer | null> {
  if (/^https?:\/\//.test(c.src)) {
    const res = await fetch(c.src, { redirect: "follow" }).catch(() => null);
    if (res && res.ok) {
      const len = Number(res.headers.get("content-length") || 0);
      if (len && len > MAX_BYTES) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      if (videoKind(buf)) return buf;
    }
  }
  if (!hands.evalJs) return null;
  // Same file read from inside the page (works for blob: URLs and links that need the tool's sign-in).
  const key = `__svv${Date.now()}`;
  const size = await hands
    .evalJs<number>(`(async () => {
      const el = document.querySelector('[data-svv="${c.index}"]');
      const src = ${JSON.stringify(c.src)};
      const url = (el && (el.currentSrc || el.src)) || src;
      const r = await fetch(url, { credentials: 'include' });
      if (!r.ok) return -1;
      const b = new Uint8Array(await r.arrayBuffer());
      if (b.length > ${MAX_BYTES}) return -2;
      window.${key} = b;
      return b.length;
    })()`)
    .catch(() => -1);
  if (!size || size < 0) return null;
  const parts: Buffer[] = [];
  const CHUNK = 1_500_000;
  for (let off = 0; off < size; off += CHUNK) {
    const b64 = await hands
      .evalJs<string>(`(() => { const b = window.${key}.subarray(${off}, ${off + CHUNK}); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); })()`)
      .catch(() => "");
    if (!b64) return null;
    parts.push(Buffer.from(b64, "base64"));
  }
  await hands.evalJs(`(() => { delete window.${key}; return 1; })()`).catch(() => {});
  const buf = Buffer.concat(parts);
  return videoKind(buf) ? buf : null;
}

async function store(b: BusinessRow, v: MarketingVideoRow, buf: Buffer): Promise<string> {
  const k = videoKind(buf)!;
  const blob = await put(`marketing/${b.id}/video-${v.id}.${k.ext}`, buf, { access: "public", contentType: k.type, addRandomSuffix: true });
  return blob.url;
}

const say = (b: BusinessRow, text: string) => addChatMessage(b.id, CHANNEL, "ai", text);

// One call: a few steps of work, then it returns (the gallery keeps calling while it's "working").
export async function advanceVideoJob(b: BusinessRow, id: string): Promise<{ video: MarketingVideoRow | null; more: boolean }> {
  let v = await getMarketingVideo(b.id, id);
  if (!v || v.status !== "making" || v.job.state !== "working") return { video: v, more: false };
  // Another worker has it right now: the gallery checks again later.
  if (v.job.runAt && Date.now() - Date.parse(v.job.runAt) < LOCK_MS) return { video: v, more: false };
  const es = b.site.lang !== "en";
  const tool = videoToolOf(v.tool);

  if (browserMode() !== "live") {
    // No cloud browser here: say so; never pretend a video was made.
    v = await updateMarketingVideo(b.id, id, { status: "failed", job: { ...v.job, state: "failed", error: "cloud browser not available" } });
    await say(b, es ? `No pude crear el video: el navegador en la nube no está disponible ahora. No se usó nada de tu cuenta.\n\n${videoToken(id)}` : `I couldn't make the video: the cloud browser isn't available right now. Nothing from your account was used.\n\n${videoToken(id)}`);
    return { video: v, more: false };
  }
  const meta = getAgentModel(90_000);
  const client = meta ?? getClaude(90_000);
  if (!client) return { video: v, more: false };

  // Take the lock (one browser worker per video at a time).
  v = (await updateMarketingVideo(b.id, id, { job: { ...v.job, runAt: new Date().toISOString() } })) ?? v;

  const state: BrowserState = { ...(v.job.browser as BrowserState) };
  const steps = [...(v.job.steps ?? [])];
  const memo = [...(v.job.memo ?? [])].slice(-40);
  const note = (s: string) => memo.push(s.slice(0, 300));
  let hands: Hands | null = null;
  let last: PageView | null = null;
  let stop: { job: Partial<VideoJob>; status?: MarketingVideoRow["status"]; videoUrl?: string; say: string } | null = null;

  const setStep = (label: string, status: "done" | "doing" | "failed") => {
    const i = steps.findIndex((s) => s.label.toLowerCase() === label.toLowerCase());
    if (i >= 0) steps[i] = { label: steps[i].label, status };
    else steps.push({ label: label.slice(0, 80), status });
  };
  const waitFor = async (kind: "login" | "pay" | "captcha" | "info", label: string, detail: string, text: string) => {
    const url = await hands!.liveUrl().catch(() => "");
    stop = { job: { state: "waiting", waiting: { kind, label: label.slice(0, 300), detail: detail.slice(0, 300), url } }, say: text };
  };
  const saved = async (buf: Buffer, how: string, text: string) => {
    const url = await store(b, v!, buf);
    for (let i = 0; i < steps.length; i++) if (steps[i].status === "doing") steps[i] = { ...steps[i], status: "done" };
    setStep(es ? "Video guardado" : "Video saved", "done");
    note(`saved via ${how}: ${Math.round(buf.length / 1024)} KB`);
    stop = { job: { state: "done", waiting: null }, status: "ready", videoUrl: url, say: text };
  };

  try {
    const raw = await getHands(state, { caseId: v.id, mode: "live", platform: tool.name, needs: [], baseUrl: "" });
    // A "captcha" flag only stands when a challenge is really shown (see SHOWN_CAPTCHA_JS).
    const shown = async (p: PageView): Promise<PageView> => (p.captcha && raw.evalJs && !(await raw.evalJs<boolean>(SHOWN_CAPTCHA_JS).catch(() => true)) ? { ...p, captcha: false } : p);
    hands = { ...raw, open: async (u) => shown(await raw.open(u)), read: async () => shown(await raw.read()) };
    await hands.allowDownloads?.();
    last = state.url ? await hands.read().catch(() => null) : null;
    const messages: MessageParam[] = [
      {
        role: "user",
        content: `Log so far:\n${memo.join("\n") || "(new video)"}\n\n${last ? `Current page:\n${view(last)}` : `No page open yet: start with browser_open ${tool.url}`}\n\nContinue.`,
      },
    ];
    const started = Date.now();
    for (let round = 0; round < ROUNDS_PER_CALL && !stop && Date.now() - started < 190_000; round++) {
      const res = meta
        ? await client.messages.create({ model: AGENT_MODEL, max_tokens: 1500, output_config: { effort: "low" }, system: system(b, v), tools: TOOLS, messages })
        : await client.messages.create({ model: MODELS.chat, max_tokens: 1500, system: system(b, v), tools: TOOLS, messages });
      const text = res.content.filter((x): x is TextBlock => x.type === "text").map((x) => x.text).join("\n").trim();
      const uses = res.content.filter((x): x is ToolUseBlock => x.type === "tool_use");
      if (!uses.length) {
        if (text) note(`agent: ${text}`);
        break;
      }
      const results: ToolResultBlockParam[] = [];
      for (const u of uses) {
        const inp = (u.input ?? {}) as Record<string, unknown>;
        let out = "ok";
        try {
          switch (u.name) {
            case "browser_open": {
              const url = String(inp.url || "");
              if (!hostAllowed(url, tool.hosts)) {
                out = `not allowed: only ${tool.name}`;
                break;
              }
              last = await hands.open(url);
              note(`open ${url} → "${last.title}"`);
              out = view(last);
              break;
            }
            case "browser_read":
              last = await hands.read();
              out = view(last);
              break;
            case "browser_fill": {
              const fid = String(inp.field || "");
              const f = last?.fields.find((x) => x.id === fid);
              if (!/^f\d{1,4}$/.test(fid)) out = "unknown field id";
              else if (f?.sensitive || SENSITIVE_FIELD.test(f?.label || "") || LOGIN_FIELD.test(`${f?.label || ""} ${f?.type || ""}`) || f?.type === "email" || f?.type === "password" || f?.type === "tel" || AUTH_HOST.test(new URL(last?.url || "about:blank").hostname)) {
                out = "the owner types this (sign-in or payment): call ask_customer_login or ask_customer_pay";
              } else {
                out = await hands.fill(fid, String(inp.value ?? "").slice(0, 2000));
                if (out === "sensitive") out = "the owner types this: call ask_customer_login or ask_customer_pay";
                note(`fill ${f?.label || fid} → ${out}`);
              }
              break;
            }
            case "browser_click": {
              const bid = String(inp.element || "");
              const btn = last?.buttons.find((x) => x.id === bid);
              if (!/^b\d{1,4}$/.test(bid)) out = "unknown element id";
              else if (btn && PAY_ACTION.test(btn.label)) out = `"${btn.label}" is about buying or a plan: call ask_customer_pay; the owner decides and pays in the live view`;
              else {
                out = await hands.click(bid);
                last = await hands.read();
                if (!hostAllowed(last.url, tool.hosts)) {
                  out = `${out}; the page left ${tool.name} (${new URL(last.url).hostname}): if it's a sign-in page, call ask_customer_login`;
                }
                note(`click "${btn?.label || bid}" → ${out.slice(0, 60)}; now "${last.title}"`);
                out = `${out}\n${view(last)}`;
              }
              break;
            }
            case "wait": {
              const s = Math.min(30, Math.max(3, Number(inp.seconds) || 15));
              await new Promise((ok) => setTimeout(ok, s * 1000));
              last = await hands.read();
              out = view(last);
              break;
            }
            case "ask_customer_login":
              await waitFor("login", es ? `${tool.name} pide que inicies sesión.` : `${tool.name} asks you to sign in.`, es ? "Inicia sesión tú en la vista en vivo (yo no veo ni guardo tus datos) y toca «Listo»." : "Sign in yourself in the live view (I don't see or keep your details) and tap “Done”.", text);
              note(`asked owner to sign in: ${String(inp.why || "")}`);
              break;
            case "ask_customer_pay": {
              const price = String(inp.price || "").trim();
              await waitFor(
                "pay",
                `${String(inp.what || "").slice(0, 200)}${price ? ` (${price})` : ""}`,
                es ? "Si quieres seguir, elige y paga tú en la vista en vivo; luego toca «Listo». Si no, dime y lo dejo." : "If you want to continue, choose and pay yourself in the live view, then tap “Done”. If not, tell me and I'll stop.",
                text
              );
              note(`asked owner to pay: ${String(inp.what || "")} ${price}`);
              break;
            }
            case "report_blocked":
              await waitFor("captcha", String(inp.reason || ""), String(inp.next_step || ""), text);
              note(`blocked: ${String(inp.reason || "")}`);
              break;
            case "step":
              setStep(String(inp.label || ""), (["done", "doing", "failed"].includes(String(inp.status)) ? inp.status : "doing") as "done" | "doing" | "failed");
              break;
            case "list_videos": {
              const list = hands.evalJs ? await hands.evalJs<VideoCandidate[]>(VIDEO_JS).catch(() => []) : [];
              out = list.length ? list.map((c) => `${c.index} | ${c.kind} | ${c.w}x${c.h} | ${c.duration}s | ${c.src.slice(0, 120)}`).join("\n") : "no videos on this page yet";
              break;
            }
            case "save_video": {
              const list = hands.evalJs ? await hands.evalJs<VideoCandidate[]>(VIDEO_JS).catch(() => []) : [];
              const c = list.find((x) => x.index === Number(inp.index));
              if (!c) {
                out = "no video with that index: list_videos again";
                break;
              }
              const buf = await grabVideo(hands, c);
              if (!buf) {
                out = "couldn't get a real video file from it: try the tool's Download button and save_download";
                break;
              }
              await saved(buf, "page", text);
              break;
            }
            case "save_download": {
              let buf: Buffer | null = null;
              for (let i = 0; i < 4 && !buf && state.sessionId; i++) {
                const zip = await browserDownloads(state.sessionId);
                buf = zip ? videoFromZip(zip) : null;
                if (!buf) await new Promise((ok) => setTimeout(ok, 4000));
              }
              if (!buf) {
                out = "no downloaded video yet: click the Download button (choose MP4 if asked) and try again";
                break;
              }
              await saved(buf, "download", text);
              break;
            }
            case "mark_failed":
              stop = { job: { state: "failed", waiting: null, error: String(inp.reason || "").slice(0, 300) }, status: "failed", say: text };
              note(`failed: ${String(inp.reason || "")}`);
              break;
            default:
              out = "unknown tool";
          }
        } catch (err) {
          out = `error: ${err instanceof Error ? err.message : "failed"}`;
        }
        // A CAPTCHA on screen stops the work right away (the owner solves it, or we don't continue).
        if (!stop && last?.captcha) {
          await waitFor(
            "captcha",
            es ? `${tool.name} pide una verificación humana (CAPTCHA).` : `${tool.name} asks for a human check (CAPTCHA).`,
            es ? "Resuélvela tú en la vista en vivo y toca «Listo», o dime que lo dejemos." : "Solve it yourself in the live view and tap “Done”, or tell me to stop.",
            ""
          );
          note("blocked: captcha");
        }
        results.push({ type: "tool_result", tool_use_id: u.id, content: out.slice(0, 9000) });
        if (stop) break;
      }
      messages.push({ role: "assistant", content: meta ? res.content.filter((x) => x.type === "text" || x.type === "tool_use") : res.content });
      messages.push({ role: "user", content: results });
    }
  } catch (err) {
    logAiError("marketing-video", err);
    const msg = err instanceof Error ? err.message : "failed";
    note(`error: ${msg}`);
    if (/browserbase|browser connect/i.test(msg)) {
      stop = { job: { state: "failed", waiting: null, error: "cloud browser not available" }, status: "failed", say: "" };
    }
  } finally {
    hands?.done();
  }

  const s = stop as { job: Partial<VideoJob>; status?: MarketingVideoRow["status"]; videoUrl?: string; say: string } | null;
  const job: VideoJob = { ...v.job, ...(s?.job ?? {}), steps, memo: memo.slice(-40), browser: state, runAt: undefined };
  v = (await updateMarketingVideo(b.id, id, { job, ...(s?.status ? { status: s.status } : {}), ...(s?.videoUrl ? { videoUrl: s.videoUrl } : {}) })) ?? v;
  if (s) {
    if (s.status === "ready" || s.status === "failed") await releaseBrowser(state);
    const fallback =
      s.status === "ready"
        ? es ? `Listo: el video ${v.title} quedó guardado en Mis videos. ¿Lo publico en Facebook e Instagram? Te digo el presupuesto antes.` : `Done: the video ${v.title} is saved in My videos. Shall I publish it on Facebook and Instagram? I'll tell you the budget first.`
        : s.status === "failed"
          ? es ? `No pude crear el video ${v.title}: ${job.error || "la herramienta no lo permitió"}. No se publicó nada.` : `I couldn't make the video ${v.title}: ${job.error || "the tool didn't allow it"}. Nothing was published.`
          : es ? "Aquí necesito que intervengas:" : "I need you here:";
    await say(b, `${(s.say || fallback).trim()}\n\n${videoToken(id)}`);
  }
  return { video: v, more: !s && v.status === "making" && v.job.state === "working" };
}

// The owner finished in the live view (signed in, paid, solved the check): continue.
export async function resumeVideoJob(b: BusinessRow, id: string, stopIt: boolean): Promise<MarketingVideoRow | null> {
  const v = await getMarketingVideo(b.id, id);
  if (!v || v.status !== "making" || v.job.state !== "waiting") return v;
  if (stopIt) {
    await releaseBrowser({ ...(v.job.browser as BrowserState) });
    const es = b.site.lang !== "en";
    await say(b, es ? `Dejé el video ${v.title}. No se publicó ni se compró nada.` : `I stopped the video ${v.title}. Nothing was published or bought.`);
    return updateMarketingVideo(b.id, id, { status: "failed", job: { ...v.job, state: "failed", waiting: null, error: "stopped by the owner" } });
  }
  const memo = [...(v.job.memo ?? []), `owner tapped Done after: ${v.job.waiting?.label || ""}`].slice(-40);
  return updateMarketingVideo(b.id, id, { job: { ...v.job, state: "working", waiting: null, memo, runAt: undefined } });
}
