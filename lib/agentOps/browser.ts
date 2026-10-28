import "server-only";
// The agent's hands: a real browser in the cloud (Browserbase) that it drives
// to do the customer's task on the official pages, with a live view the
// customer uses to type what's sensitive themselves. Without a Browserbase key
// the same engine runs against a practice office (sandbox.ts) so the whole flow
// can be tried end to end without sending anything real.
//
// The model never sees sensitive values: reads mask password / card / SSN
// fields, and it can't type into them (only the customer can, in the live view).
// CAPTCHAs are never solved automatically.

import { createHmac } from "node:crypto";
import { sandboxClick, sandboxFill, sandboxOpen, sandboxRead, type SandboxState } from "./sandbox";

export type PageField = { id: string; label: string; type: string; value: string; options?: string[]; sensitive: boolean; required: boolean };
export type PageButton = { id: string; label: string; kind: "button" | "link" };
export type PageView = { url: string; title: string; text: string; fields: PageField[]; buttons: PageButton[]; captcha: boolean };

export type BrowserState = { sessionId?: string; connectUrl?: string; liveUrl?: string; url?: string; lastText?: string; sandbox?: SandboxState };

const BB = "https://api.browserbase.com/v1";

export function browserMode(): "live" | "test" {
  return process.env.BROWSERBASE_API_KEY && process.env.AGENT_OPS_MODE !== "test" ? "live" : "test";
}

// Words that mark a field as sensitive (the customer types it, never the AI).
export const SENSITIVE_FIELD = /(password|contrase|passcode|\bpin\b|card|tarjeta|cc-?num|cc-?csc|cvv|cvc|security code|c[oó]digo de seguridad|expir|vencimiento|ssn|social security|seguro social|\bitin\b|routing|account number|n[uú]mero de cuenta|bank)/i;

// ---------- minimal Chrome DevTools Protocol client (no extra packages) ----------
class Cdp {
  private ws: WebSocket;
  private n = 0;
  private waiters = new Map<number, { ok: (v: unknown) => void; ko: (e: Error) => void }>();
  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener("message", (ev) => {
      try {
        const m = JSON.parse(String(ev.data)) as { id?: number; result?: unknown; error?: { message: string } };
        if (m.id && this.waiters.has(m.id)) {
          const w = this.waiters.get(m.id)!;
          this.waiters.delete(m.id);
          if (m.error) w.ko(new Error(m.error.message));
          else w.ok(m.result);
        }
      } catch {
        // ignore events we don't use
      }
    });
  }
  static connect(url: string): Promise<Cdp> {
    return new Promise((ok, ko) => {
      const ws = new WebSocket(url);
      const t = setTimeout(() => ko(new Error("browser connect timeout")), 20_000);
      ws.addEventListener("open", () => {
        clearTimeout(t);
        ok(new Cdp(ws));
      });
      ws.addEventListener("error", () => {
        clearTimeout(t);
        ko(new Error("browser connect failed"));
      });
    });
  }
  send<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<T> {
    const id = ++this.n;
    return new Promise<T>((ok, ko) => {
      const t = setTimeout(() => {
        this.waiters.delete(id);
        ko(new Error(`${method} timeout`));
      }, 30_000);
      this.waiters.set(id, {
        ok: (v) => {
          clearTimeout(t);
          ok(v as T);
        },
        ko: (e) => {
          clearTimeout(t);
          ko(e);
        },
      });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

// Runs in the page: tags fields/buttons with data-sv ids and returns what's on screen.
const READ_JS = `(() => {
  const SENS = ${SENSITIVE_FIELD.toString()};
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const txt = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const labelOf = (el) => {
    if (el.id) { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l) return txt(l.innerText); }
    const wrap = el.closest('label'); if (wrap) return txt(wrap.innerText);
    return txt(el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title') || el.name || el.id);
  };
  let n = 0;
  const fields = [];
  document.querySelectorAll('input, select, textarea').forEach((el) => {
    const type = (el.getAttribute('type') || el.tagName).toLowerCase();
    if (['hidden', 'submit', 'button', 'image', 'reset'].includes(type) || !vis(el)) return;
    const id = 'f' + (++n); el.setAttribute('data-sv', id);
    const label = labelOf(el).slice(0, 120);
    const meta = [label, el.name, el.id, el.getAttribute('autocomplete') || ''].join(' ');
    const sensitive = type === 'password' || /cc-/.test(el.getAttribute('autocomplete') || '') || SENS.test(meta);
    let value = type === 'checkbox' || type === 'radio' ? (el.checked ? 'checked' : '') : (el.value || '');
    if (sensitive) value = value ? '[filled by the customer]' : '';
    const f = { id, label, type, value: String(value).slice(0, 200), sensitive, required: !!el.required };
    if (el.tagName === 'SELECT') f.options = Array.from(el.options).map((o) => txt(o.text)).slice(0, 60);
    fields.push(f);
  });
  // Rich text boxes (many web apps use them for prompts instead of a textarea).
  document.querySelectorAll('[contenteditable="true"], [contenteditable=""], [role=textbox]').forEach((el) => {
    if (el.matches('input, textarea, select') || el.closest('[data-sv]') || !vis(el) || fields.length >= 80) return;
    const id = 'f' + (++n); el.setAttribute('data-sv', id);
    const label = txt(el.getAttribute('aria-label') || el.getAttribute('data-placeholder') || el.getAttribute('placeholder') || el.title || 'text box').slice(0, 120);
    const sensitive = SENS.test(label);
    fields.push({ id, label, type: 'editable', value: sensitive ? '' : txt(el.innerText).slice(0, 200), sensitive, required: false });
  });
  const buttons = [];
  document.querySelectorAll('button, input[type=submit], input[type=button], a[href], [role=button]').forEach((el) => {
    if (!vis(el) || buttons.length >= 60) return;
    const label = txt(el.innerText || el.value || el.getAttribute('aria-label') || el.title).slice(0, 80);
    if (!label) return;
    const id = 'b' + (++n); el.setAttribute('data-sv', id);
    buttons.push({ id, label, kind: el.tagName === 'A' ? 'link' : 'button' });
  });
  const captcha = !!document.querySelector('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="challenges.cloudflare"], .g-recaptcha, .h-captcha, .cf-turnstile') || /captcha|verify you are human|no soy un robot|are you a robot/i.test(document.body.innerText.slice(0, 4000));
  return { url: location.href, title: document.title, text: txt(document.body.innerText).slice(0, 6000), fields, buttons, captcha };
})()`;

const FILL_JS = (id: string, value: string) => `(() => {
  const el = document.querySelector('[data-sv="${id}"]');
  if (!el) return 'not found';
  const type = (el.getAttribute('type') || el.tagName).toLowerCase();
  const meta = [el.name, el.id, el.getAttribute('autocomplete') || '', el.getAttribute('aria-label') || '', el.getAttribute('placeholder') || ''].join(' ');
  if (type === 'password' || /cc-/.test(el.getAttribute('autocomplete') || '') || ${SENSITIVE_FIELD.toString()}.test(meta)) return 'sensitive';
  const v = ${JSON.stringify(value)};
  if (el.isContentEditable) {
    el.focus();
    const sel = window.getSelection(); const range = document.createRange(); range.selectNodeContents(el); sel.removeAllRanges(); sel.addRange(range);
    if (!document.execCommand('insertText', false, v)) el.textContent = v;
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: v, inputType: 'insertText' }));
    return 'ok';
  }
  if (el.tagName === 'SELECT') {
    const o = Array.from(el.options).find((o) => o.text.trim().toLowerCase() === v.toLowerCase() || o.value === v) || Array.from(el.options).find((o) => o.text.toLowerCase().includes(v.toLowerCase()));
    if (!o) return 'no such option';
    el.value = o.value;
  } else if (type === 'checkbox' || type === 'radio') {
    const want = /^(true|yes|s[ií]|check|checked|1)$/i.test(v);
    if (el.checked !== want) el.click();
    return 'ok';
  } else {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('blur', { bubbles: true }));
  return 'ok';
})()`;

const CLICK_JS = (id: string) => `(() => {
  const el = document.querySelector('[data-sv="${id}"]');
  if (!el) return 'not found';
  el.scrollIntoView({ block: 'center' });
  el.click();
  return 'ok';
})()`;

async function bb<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BB}${path}`, {
    ...init,
    headers: { "X-BB-API-Key": process.env.BROWSERBASE_API_KEY || "", "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`browserbase ${res.status}`);
  return (await res.json()) as T;
}

// One live connection to the case's cloud browser, for the length of a request.
class LiveBrowser {
  constructor(private state: BrowserState, private cdp: Cdp, private sid: string) {}

  private static async create(state: BrowserState) {
    // keepAlive keeps the browser open while the customer types or approves
    // (between requests); it needs a paid Browserbase plan.
    const created = await bb<{ id: string; connectUrl: string }>("/sessions", {
      method: "POST",
      body: JSON.stringify({
        ...(process.env.BROWSERBASE_PROJECT_ID ? { projectId: process.env.BROWSERBASE_PROJECT_ID } : {}),
        keepAlive: true,
        timeout: 3600,
        // Never solve CAPTCHAs for the customer: the agent stops and says so.
        browserSettings: { solveCaptchas: false, blockAds: true, viewport: { width: 1280, height: 900 } },
        userMetadata: { app: "sevrii-agent" },
      }),
    });
    state.sessionId = created.id;
    state.connectUrl = created.connectUrl;
    state.url = undefined;
    state.lastText = undefined;
  }

  static async attach(state: BrowserState): Promise<LiveBrowser> {
    if (!state.sessionId || !state.connectUrl) await LiveBrowser.create(state);
    let cdp: Cdp;
    try {
      cdp = await Cdp.connect(state.connectUrl!);
    } catch {
      // The earlier browser ended (timeout): start a new one from the official page.
      await LiveBrowser.create(state);
      cdp = await Cdp.connect(state.connectUrl!);
    }
    const { targetInfos } = await cdp.send<{ targetInfos: { targetId: string; type: string }[] }>("Target.getTargets");
    let page = targetInfos.find((t) => t.type === "page");
    if (!page) {
      const { targetId } = await cdp.send<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
      page = { targetId, type: "page" };
    }
    const { sessionId } = await cdp.send<{ sessionId: string }>("Target.attachToTarget", { targetId: page.targetId, flatten: true });
    await cdp.send("Page.enable", {}, sessionId).catch(() => {});
    return new LiveBrowser(state, cdp, sessionId);
  }

  private async eval<T>(expression: string): Promise<T> {
    const r = await this.cdp.send<{ result: { value: T }; exceptionDetails?: unknown }>("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, this.sid);
    if (r.exceptionDetails) throw new Error("page script failed");
    return r.result.value;
  }

  private async settle() {
    for (let i = 0; i < 30; i++) {
      await new Promise((ok) => setTimeout(ok, 500));
      const ready = await this.eval<string>("document.readyState").catch(() => "loading");
      if (ready === "complete" && i >= 1) return;
    }
  }

  async open(url: string): Promise<PageView> {
    await this.cdp.send("Page.navigate", { url }, this.sid);
    await this.settle();
    return this.read();
  }
  async read(): Promise<PageView> {
    const v = await this.eval<PageView>(READ_JS);
    this.state.url = v.url;
    this.state.lastText = v.text;
    return v;
  }
  async fill(id: string, value: string): Promise<string> {
    return this.eval<string>(FILL_JS(id, value));
  }
  async click(id: string): Promise<string> {
    const r = await this.eval<string>(CLICK_JS(id));
    await this.settle();
    return r;
  }
  // Runs a script in the page (for reading what the page shows, never to type secrets).
  async evalJs<T>(expression: string): Promise<T> {
    return this.eval<T>(expression);
  }
  // Files the page downloads are kept by the cloud browser (read with browserDownloads).
  async allowDownloads(): Promise<void> {
    await this.cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: "downloads", eventsEnabled: true }).catch(() => {});
  }
  async liveUrl(): Promise<string> {
    const d = await bb<{ debuggerFullscreenUrl?: string; pages?: { debuggerFullscreenUrl?: string }[] }>(`/sessions/${this.state.sessionId}/debug`);
    const url = d.pages?.[0]?.debuggerFullscreenUrl || d.debuggerFullscreenUrl || "";
    this.state.liveUrl = url;
    return url;
  }
  detach() {
    this.cdp.close();
  }
}

// What the cloud browser downloaded in this session (a zip from Browserbase), or null.
export async function browserDownloads(sessionId: string): Promise<Buffer | null> {
  const res = await fetch(`${BB}/sessions/${sessionId}/downloads`, { headers: { "X-BB-API-Key": process.env.BROWSERBASE_API_KEY || "" } }).catch(() => null);
  if (!res || !res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.length > 22 ? buf : null;
}

export async function releaseBrowser(state: BrowserState): Promise<void> {
  if (!state.sessionId || browserMode() !== "live") return;
  await bb(`/sessions/${state.sessionId}`, {
    method: "POST",
    body: JSON.stringify({ status: "REQUEST_RELEASE", ...(process.env.BROWSERBASE_PROJECT_ID ? { projectId: process.env.BROWSERBASE_PROJECT_ID } : {}) }),
  }).catch(() => {});
}

// The same five moves for both browsers.
export type Hands = {
  mode: "live" | "test";
  open(url: string): Promise<PageView>;
  read(): Promise<PageView>;
  fill(id: string, value: string): Promise<string>;
  click(id: string): Promise<string>;
  liveUrl(): Promise<string>;
  done(): void;
  // Live browser only: read the page with a script, keep downloads.
  evalJs?<T>(expression: string): Promise<T>;
  allowDownloads?(): Promise<void>;
};

// A case keeps the mode it was created with: a test case always runs in the
// practice office (even after the cloud browser key is added), and a live case
// never falls back to the practice office.
export async function getHands(state: BrowserState, ctx: { caseId: string; mode: "live" | "test"; platform: string; needs: string[]; baseUrl: string }): Promise<Hands> {
  if (ctx.mode === "live") {
    if (browserMode() !== "live") throw new Error("browserbase not configured");
    const b = await LiveBrowser.attach(state);
    return {
      mode: "live",
      open: (u) => b.open(u),
      read: () => b.read(),
      fill: (i, v) => b.fill(i, v),
      click: (i) => b.click(i),
      liveUrl: () => b.liveUrl(),
      done: () => b.detach(),
      evalJs: <T,>(e: string) => b.evalJs<T>(e),
      allowDownloads: () => b.allowDownloads(),
    };
  }
  if (state.sessionId) {
    // A cloud browser left open on a test case: close it and forget it.
    await releaseBrowser(state);
    state.sessionId = undefined;
    state.connectUrl = undefined;
    state.liveUrl = undefined;
  }
  if (state.url && !state.url.startsWith("https://practica.sevrii.com")) {
    state.url = undefined;
    state.lastText = undefined;
  }
  state.sandbox ??= { page: "start", values: {}, cardEntered: false, confirmation: "", platform: ctx.platform, needs: ctx.needs };
  const sb = state.sandbox;
  const remember = (v: PageView) => {
    state.url = v.url;
    state.lastText = v.text;
    return v;
  };
  return {
    mode: "test",
    open: async () => remember(sandboxOpen(sb)),
    read: async () => remember(sandboxRead(sb)),
    fill: async (i, v) => sandboxFill(sb, i, v),
    click: async (i) => {
      const r = sandboxClick(sb, i);
      remember(sandboxRead(sb));
      return r;
    },
    liveUrl: async () => `${ctx.baseUrl}/api/agent-case/live?c=${encodeURIComponent(ctx.caseId)}&k=${liveKey(ctx.caseId)}`,
    done: () => {},
  };
}

// Signs the practice office's live view link for one case.
export function liveKey(caseId: string): string {
  const secret = process.env.SEVRII_TOKEN_KEY || process.env.AUTH_SECRET || process.env.DATABASE_URL || "sevrii";
  return createHmac("sha256", secret).update(`live:${caseId}`).digest("hex").slice(0, 32);
}
