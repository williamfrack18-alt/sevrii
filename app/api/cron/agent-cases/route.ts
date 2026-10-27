import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { addConvMessage, getBusinessById, getConversationById, listCasesWithDueReminders, listPendingCasesToRecheck, updateAgentCase } from "@/lib/db";
import { advanceCase } from "@/lib/agentOps/runner";
import { runForUser, serviceAgentAccount, serviceAgentGate } from "@/lib/usage";
import { sendEmail } from "@/lib/email";
import { caseToken } from "@/lib/agentOps/runner";

// Proactive reminders from service agents' cases (e.g. "your LLC's annual
// report is due by May 1"): written into the customer's chat, and emailed when
// the customer left an email. Called daily by Vercel Cron (see vercel.json).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const got = Buffer.from(req.headers.get("authorization") || "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ ok: false }, { status: 401 });
  const cases = await listCasesWithDueReminders(200);
  let sent = 0;
  for (const c of cases) {
    const b = await getBusinessById(c.businessId);
    const conv = await getConversationById(c.conversationId);
    if (!b || !conv) continue;
    const es = b.site.lang !== "en";
    const now = new Date().toISOString();
    const reminders = c.reminders.map((r) => ({ ...r }));
    for (const r of reminders) {
      if (r.sentAt || r.dueAt > now) continue;
      await addConvMessage(conv.id, "ai", `${es ? "Recordatorio" : "Reminder"}: ${r.text}\n\n${caseToken(c.id)}`);
      if (conv.email) {
        const link = `https://www.sevrii.com/site/${b.slug}/agente`;
        const name = b.serviceAgent.name || b.name;
        await sendEmail(
          conv.email,
          `${es ? "Recordatorio de" : "Reminder from"} ${name}`,
          `<p>${esc(r.text)}</p><p><a href="${link}">${es ? "Abrir el chat" : "Open the chat"}</a></p>`,
          `${r.text}\n\n${link}`
        ).catch(() => false);
      }
      r.sentAt = now;
      sent++;
    }
    await updateAgentCase(c.id, { reminders });
  }
  // Pending cases (e.g. the state hadn't confirmed yet): the agent checks the
  // official record again, once a day, and closes them when it's verified.
  const started = Date.now();
  let rechecked = 0;
  for (const c of await listPendingCasesToRecheck(10)) {
    if (Date.now() - started > 200_000) break;
    const b = await getBusinessById(c.businessId);
    if (!b || !(await serviceAgentGate(b.userId))) continue;
    const answers = `${c.data.__answers ? `${c.data.__answers}\n` : ""}(Revisión diaria: vuelve a comprobar en la página oficial si ya quedó hecho.)`.slice(-2000);
    const working = await updateAgentCase(c.id, { status: "working", waiting: null, data: { ...c.data, __answers: answers } });
    if (!working) continue;
    const r = await runForUser(serviceAgentAccount(b.userId), () => advanceCase(b, working, "https://www.sevrii.com")).catch(() => null);
    // Still not confirmed: back to pending for tomorrow.
    if (r && r.case.status === "working") await updateAgentCase(c.id, { status: "pending", waiting: c.waiting });
    rechecked++;
  }
  return NextResponse.json({ ok: true, sent, rechecked });
}
