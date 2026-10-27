import "server-only";
// The agent at work on a case: it operates the official pages itself until the
// task is done and verified, or until it needs the customer (something
// sensitive to type in the live view, an OK before signing / submitting /
// paying, or a missing piece of information). Each call does a few steps and
// returns; the chat keeps calling while the case is "working".

import type { MessageParam, TextBlock, Tool, ToolResultBlockParam, ToolUseBlock } from "@anthropic-ai/sdk/resources/messages";
import { AGENT_MODEL, MODELS, getAgentModel, getClaude, logAiError } from "../claude";
import { addConvMessage, updateAgentCase, type AgentCaseRow, type AgentCaseStep, type BusinessRow } from "../db";
import { getHands, releaseBrowser, type BrowserState, type Hands, type PageView } from "./browser";

const ROUNDS_PER_CALL = 10;
// Buttons that sign, submit or pay: only after the customer's explicit OK.
const FINAL_ACTION = /(submit|send|sign|pay|purchase|place order|file|confirm|complete|finalize|enviar|presentar|firmar|pagar|comprar|confirmar|finalizar|completar|radicar)/i;
const OK_TTL_MS = 30 * 60 * 1000;

export function caseToken(id: string) {
  return `[[case:${id}]]`;
}

function view(v: PageView): string {
  const fields = v.fields.map((f) => `${f.id} | ${f.label || "(sin etiqueta)"} | ${f.type}${f.options ? ` | opciones: ${f.options.slice(0, 25).join(" / ")}` : ""} | valor: ${f.value || "(vacío)"}${f.sensitive ? " | SENSIBLE: lo escribe el cliente" : ""}${f.required ? " | obligatorio" : ""}`);
  const buttons = v.buttons.map((b) => `${b.id} | ${b.label}${b.kind === "link" ? " (enlace)" : ""}`);
  return [
    `URL: ${v.url}`,
    `Título: ${v.title}`,
    v.captcha ? "AVISO: la página pide un CAPTCHA o verificación humana." : "",
    `Texto: ${v.text.slice(0, 3500)}`,
    fields.length ? `Campos:\n${fields.join("\n")}` : "Campos: ninguno",
    buttons.length ? `Botones y enlaces:\n${buttons.slice(0, 50).join("\n")}` : "Botones: ninguno",
  ]
    .filter(Boolean)
    .join("\n");
}

const TOOLS: Tool[] = [
  { name: "browser_open", description: "Open a page (only the task's platforms).", input_schema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } },
  { name: "browser_read", description: "Read the current page again.", input_schema: { type: "object", properties: {} } },
  { name: "browser_fill", description: "Type a value in a field (by id). Never for sensitive fields.", input_schema: { type: "object", properties: { field: { type: "string" }, value: { type: "string" } }, required: ["field", "value"] } },
  { name: "browser_click", description: "Click a button or link (by id). Signing, submitting or paying needs ask_customer_ok first.", input_schema: { type: "object", properties: { element: { type: "string" } }, required: ["element"] } },
  {
    name: "ask_customer_input",
    description: "Something sensitive (password, card, SSN, a code sent to their phone) is needed now: the customer types it themselves in the live view of this page. Stops until they're done.",
    input_schema: { type: "object", properties: { what: { type: "string" }, why: { type: "string" } }, required: ["what", "why"] },
  },
  {
    name: "ask_customer_ok",
    description: "Before signing, submitting or paying: show the customer a short summary of exactly what will be done (and the amount, if paying) and wait for their OK.",
    input_schema: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] },
  },
  { name: "ask_customer_info", description: "A non-sensitive piece of information is missing: ask it in the chat. Stops until they answer.", input_schema: { type: "object", properties: { question: { type: "string" } }, required: ["question"] } },
  { name: "step", description: "Update the customer's file: a step and its status.", input_schema: { type: "object", properties: { label: { type: "string" }, status: { type: "string", enum: ["done", "doing", "todo", "failed"] } }, required: ["label", "status"] } },
  { name: "add_document", description: "Add a document or official link to the file (receipt, certificate, record).", input_schema: { type: "object", properties: { name: { type: "string" }, url: { type: "string" } }, required: ["name", "url"] } },
  { name: "set_reminder", description: "A proactive reminder for the customer (a deadline that comes from the task).", input_schema: { type: "object", properties: { date: { type: "string", description: "YYYY-MM-DD" }, text: { type: "string" } }, required: ["date", "text"] } },
  {
    name: "report_blocked",
    description: "The site blocks automatic operation (CAPTCHA, extra verification, an error you can't fix). Say it plainly with the official link and the exact step missing.",
    input_schema: { type: "object", properties: { reason: { type: "string" }, url: { type: "string" }, next_step: { type: "string" } }, required: ["reason", "url", "next_step"] },
  },
  {
    name: "finish",
    description: "The task is done: give the proof shown on the page (confirmation / document number, or the result's link). It's checked against the page; if it isn't there it won't close.",
    input_schema: { type: "object", properties: { kind: { type: "string", description: "e.g. 'Número de documento'" }, value: { type: "string" }, url: { type: "string" } }, required: ["kind", "value"] },
  },
  { name: "mark_pending", description: "It can't be verified as done yet (e.g. the office reviews it in days): leave it pending with the reason and the next step.", input_schema: { type: "object", properties: { reason: { type: "string" }, next_step: { type: "string" } }, required: ["reason", "next_step"] } },
];

function hostOk(url: string, platforms: { url: string }[], mode: "live" | "test"): boolean {
  if (mode === "test") return true;
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    return platforms.some((p) => {
      const ph = new URL(p.url).hostname.replace(/^www\./, "");
      return h === ph || h.endsWith(`.${ph}`) || ph.endsWith(`.${h}`);
    });
  } catch {
    return false;
  }
}

const norm = (s: string) => s.toLowerCase().replace(/[\s\-–—]+/g, "");

function system(b: BusinessRow, c: AgentCaseRow, mode: "live" | "test"): string {
  const a = b.serviceAgent;
  const t = a.task;
  const es = b.site.lang !== "en";
  return `You are "${a.name}", an AI agent that DOES the customer's task yourself, end to end. You operate the official pages in a real browser; the customer doesn't do the paperwork.
Task: ${t.goal}
Where you work (official first): ${t.platforms.map((p) => `${p.name} ${p.url}`).join(" · ")}
Data you need (already collected in the case data, or ask with ask_customer_info): ${t.needs.join("; ") || "-"}
Sensitive (the customer types it in the live view, at that moment): ${t.sensitive.map((x) => `${x.what} (${x.when})`).join("; ") || "-"}
Needs the customer's OK before: ${t.confirmBefore.join("; ") || "signing, submitting or paying"}
How you prove it's done: ${t.verify}
What the customer receives: ${t.deliver}
Reminders: ${t.reminders || "-"}

How you work:
${a.instructions}

Knowledge (verified facts; never invent fees, deadlines or requirements):
${a.knowledge.slice(0, 12000) || "-"}

Rules:
- Go step by step: open the official page, read it, fill fields with the case data, continue. Keep the customer's file updated with step (short labels in ${es ? "Spanish" : "English"}).
- NEVER type a sensitive value and never ask for one in the chat: call ask_customer_input and the customer types it in the live view.
- Before signing, submitting or paying, call ask_customer_ok with an exact summary (what, for whom, amount). A signature with someone's name only with that person's OK.
- If a page shows a CAPTCHA or an extra human verification: report_blocked with the official link and the exact step. Never try to get around it and never pretend it worked.
- Close only with finish, giving the proof that is on the page (number, confirmation). If the office doesn't confirm right away, mark_pending.
- If the data is missing or wrong, ask_customer_info. Don't guess personal data.
- Your text replies are short updates for the customer, in ${es ? "Spanish" : "English"}, plain text.
${mode === "test" ? "- TEST MODE: you operate a practice office (nothing real is sent). Say so when you finish: the result is a test." : ""}

Case data from the chat (non-sensitive): ${JSON.stringify(Object.fromEntries(Object.entries(c.data).filter(([k]) => !k.startsWith("__"))))}
Customer's corrections or answers: ${c.data.__answers || "-"}`;
}

type Stop = { status: AgentCaseRow["status"]; waiting: AgentCaseRow["waiting"]; say: string } | null;

export async function advanceCase(b: BusinessRow, c: AgentCaseRow, baseUrl: string): Promise<{ case: AgentCaseRow; more: boolean }> {
  if (c.status !== "working") return { case: c, more: false };
  const meta = getAgentModel(90_000);
  const client = meta ?? getClaude(90_000);
  if (!client) return { case: c, more: false };
  const task = b.serviceAgent.task;
  const state: BrowserState = { ...(c.browser as BrowserState) };
  const steps: AgentCaseStep[] = [...c.steps];
  const docs = [...c.docs];
  const reminders = [...c.reminders];
  const data: Record<string, string> = { ...c.data };
  const log: string[] = (Array.isArray(c.memo) ? c.memo : []).map((m) => String((m as { content: unknown }).content ?? "")).slice(-40);
  const note = (s: string) => log.push(s.slice(0, 300));
  const now = () => new Date().toISOString();
  let hands: Hands | null = null;
  let last: PageView | null = null;
  let stop: Stop = null;
  let result = c.result;

  const setStep = (label: string, status: AgentCaseStep["status"]) => {
    const i = steps.findIndex((s) => s.label.toLowerCase() === label.toLowerCase());
    if (i >= 0) steps[i] = { label: steps[i].label, status, at: now() };
    else steps.push({ label: label.slice(0, 80), status, at: now() });
  };

  try {
    hands = await getHands(state, { caseId: c.id, platform: task.platforms[0]?.name || "", needs: task.needs, baseUrl });
    const mode = hands.mode;
    // Where we are: the page the browser has open (or nothing yet).
    const startView = state.url ? await hands.read().catch(() => null) : null;
    last = startView;
    const messages: MessageParam[] = [
      {
        role: "user",
        content: `Log so far:\n${log.join("\n") || "(new case)"}\n\n${startView ? `Current page:\n${view(startView)}` : "No page open yet: start with browser_open on the official platform."}\n\nContinue the task.`,
      },
    ];

    for (let round = 0; round < ROUNDS_PER_CALL && !stop; round++) {
      const res = meta
        ? await client.messages.create({ model: AGENT_MODEL, max_tokens: 2000, output_config: { effort: "low" }, system: system(b, { ...c, data }, mode), tools: TOOLS, messages })
        : await client.messages.create({ model: MODELS.chat, max_tokens: 2000, system: system(b, { ...c, data }, mode), tools: TOOLS, messages });
      const text = res.content.filter((x): x is TextBlock => x.type === "text").map((x) => x.text).join("\n").trim();
      const uses = res.content.filter((x): x is ToolUseBlock => x.type === "tool_use");
      if (!uses.length) {
        // Talking without acting: keep the update and pause until the next call.
        if (text) note(`agent: ${text}`);
        break;
      }
      const results: ToolResultBlockParam[] = [];
      for (const u of uses) {
        const inp = (u.input ?? {}) as Record<string, string>;
        let out = "ok";
        try {
          switch (u.name) {
            case "browser_open": {
              if (!hostOk(inp.url, task.platforms, mode)) {
                out = "not allowed: only the task's official platforms";
                break;
              }
              last = await hands.open(inp.url);
              note(`open ${inp.url} → "${last.title}"`);
              out = view(last);
              break;
            }
            case "browser_read":
              last = await hands.read();
              out = view(last);
              break;
            case "browser_fill": {
              const id = String(inp.field || "");
              if (!/^f\d{1,4}$/.test(id)) {
                out = "unknown field id";
                break;
              }
              const f = last?.fields.find((x) => x.id === id);
              if (f?.sensitive) {
                out = "sensitive field: the customer types it (ask_customer_input)";
                break;
              }
              out = await hands.fill(id, String(inp.value ?? "").slice(0, 400));
              if (out === "sensitive") out = "sensitive field: the customer types it (ask_customer_input)";
              note(`fill ${f?.label || id} → ${out}`);
              break;
            }
            case "browser_click": {
              const id = String(inp.element || "");
              if (!/^b\d{1,4}$/.test(id)) {
                out = "unknown element id";
                break;
              }
              const btn = last?.buttons.find((x) => x.id === id);
              const final = btn ? FINAL_ACTION.test(btn.label) && btn.kind === "button" : false;
              const okAt = data.__ok ? Date.parse(data.__ok) : 0;
              if (final && !(okAt && Date.now() - okAt < OK_TTL_MS)) {
                out = `"${btn?.label}" signs, submits or pays: call ask_customer_ok first`;
                break;
              }
              out = await hands.click(id);
              if (final && out === "ok") delete data.__ok; // one OK, one final action
              last = await hands.read();
              note(`click "${btn?.label || id}" → ${out}; now "${last.title}"`);
              out = `${out}\n${view(last)}`;
              break;
            }
            case "ask_customer_input": {
              const url = await hands.liveUrl();
              stop = { status: "needs_input", waiting: { kind: "sensitive", label: String(inp.what).slice(0, 120), detail: String(inp.why).slice(0, 300), url }, say: text };
              note(`asked the customer to type: ${inp.what}`);
              break;
            }
            case "ask_customer_ok":
              stop = { status: "needs_ok", waiting: { kind: "confirm", label: String(inp.summary).slice(0, 600), detail: "", url: "" }, say: text };
              data.__okAsked = now();
              note(`asked OK: ${inp.summary}`);
              break;
            case "ask_customer_info":
              stop = { status: "needs_input", waiting: { kind: "info", label: String(inp.question).slice(0, 300), detail: "", url: "" }, say: text || String(inp.question) };
              note(`asked: ${inp.question}`);
              break;
            case "step":
              setStep(String(inp.label || ""), (["done", "doing", "todo", "failed"].includes(inp.status) ? inp.status : "doing") as AgentCaseStep["status"]);
              break;
            case "add_document":
              if (/^https?:\/\//.test(String(inp.url))) docs.push({ name: String(inp.name).slice(0, 80), url: String(inp.url).slice(0, 500) });
              else out = "url must be http(s)";
              break;
            case "set_reminder":
              if (/^\d{4}-\d{2}-\d{2}$/.test(String(inp.date)) && Date.parse(inp.date) > Date.now()) reminders.push({ dueAt: `${inp.date}T14:00:00.000Z`, text: String(inp.text).slice(0, 300), sentAt: null });
              else out = "date must be YYYY-MM-DD in the future";
              break;
            case "report_blocked": {
              const url = await hands.liveUrl().catch(() => "");
              stop = { status: "blocked", waiting: { kind: "captcha", label: String(inp.reason).slice(0, 300), detail: String(inp.next_step).slice(0, 300), url: /^https?:\/\//.test(inp.url) ? inp.url : url }, say: text };
              data.__live = url;
              note(`blocked: ${inp.reason}`);
              break;
            }
            case "finish": {
              const page = (state.lastText || last?.text || "").toString();
              const value = String(inp.value || "").trim();
              if (value.length < 3 || !norm(page).includes(norm(value))) {
                out = "not verified: that value isn't on the current page. Read the confirmation page and use the exact number/link, or mark_pending.";
                break;
              }
              result = { kind: String(inp.kind).slice(0, 60), value: value.slice(0, 120), url: /^https?:\/\//.test(String(inp.url || "")) ? String(inp.url) : state.url || "", verifiedAt: now(), test: mode === "test" };
              stop = { status: "done", waiting: null, say: text };
              note(`done: ${inp.kind} ${value}`);
              break;
            }
            case "mark_pending":
              stop = { status: "pending", waiting: { kind: "info", label: String(inp.reason).slice(0, 300), detail: String(inp.next_step).slice(0, 300), url: "" }, say: text };
              note(`pending: ${inp.reason}`);
              break;
            default:
              out = "unknown tool";
          }
        } catch (err) {
          out = `error: ${err instanceof Error ? err.message : "failed"}`;
        }
        // A CAPTCHA on screen stops the work right away (never solved for the customer).
        if (!stop && last?.captcha) {
          const url = await hands.liveUrl().catch(() => "");
          stop = {
            status: "blocked",
            waiting: { kind: "captcha", label: b.site.lang === "en" ? "The official page asks for a human check (CAPTCHA)." : "La página oficial pide una verificación humana (CAPTCHA).", detail: b.site.lang === "en" ? "Complete it yourself in the live view, then tap “Done”." : "Complétala tú en la vista en vivo y luego toca «Listo».", url },
            say: "",
          };
          note("blocked: captcha");
        }
        results.push({ type: "tool_result", tool_use_id: u.id, content: out.slice(0, 9000) });
        if (stop) break;
      }
      messages.push({ role: "assistant", content: meta ? res.content.filter((x) => x.type === "text" || x.type === "tool_use") : res.content });
      messages.push({ role: "user", content: results });
      if (stop && !stop.say && text) stop.say = text;
    }
  } catch (err) {
    logAiError("agent-case", err);
    const msg = err instanceof Error ? err.message : "failed";
    note(`error: ${msg}`);
    // The cloud browser itself isn't available (key, plan or service): say so
    // instead of retrying forever, and leave the case pending.
    if (/browserbase|browser connect/i.test(msg)) {
      const es = b.site.lang !== "en";
      stop = {
        status: "pending",
        waiting: {
          kind: "info",
          label: es ? "El navegador en la nube no está disponible ahora mismo." : "The cloud browser isn't available right now.",
          detail: es ? "Lo intento de nuevo más tarde; no se envió nada." : "I'll try again later; nothing was sent.",
          url: "",
        },
        say: "",
      };
    }
  } finally {
    hands?.done();
  }

  const patch: Partial<AgentCaseRow> = {
    steps,
    docs,
    reminders,
    data,
    result,
    browser: state as AgentCaseRow["browser"],
    memo: log.slice(-40).map((content) => ({ role: "log", content })),
  };
  if (stop) {
    patch.status = stop.status;
    patch.waiting = stop.waiting;
  }
  const saved = (await updateAgentCase(c.id, patch)) ?? c;
  if (stop) {
    if (stop.status === "done") await releaseBrowser(state);
    const es = b.site.lang !== "en";
    const fallback =
      stop.status === "done"
        ? es ? "Listo: tu trámite quedó hecho y verificado. Aquí está el resultado." : "Done: your task is finished and verified. Here's the result."
        : stop.status === "needs_ok"
          ? es ? "Antes de enviarlo necesito tu OK. Revisa el resumen:" : "Before I submit it I need your OK. Check the summary:"
          : stop.status === "needs_input"
            ? stop.waiting?.kind === "sensitive" ? (es ? "Este dato lo escribes tú, directo en la página oficial:" : "You type this yourself, right on the official page:") : ""
            : es ? "Aquí necesito que intervengas:" : "I need you here:";
    await addConvMessage(c.conversationId, "ai", `${(stop.say || fallback).trim()}\n\n${caseToken(c.id)}`.trim());
  }
  return { case: saved, more: !stop && saved.status === "working" };
}
