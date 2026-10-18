import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getUserById, listAgentBusinesses, markAgentRan } from "@/lib/db";
import { limitsFor } from "@/lib/billing";
import { runDaily } from "@/lib/marketingAgent";

// The marketing agent's daily check, called by Vercel Cron (see vercel.json).
// With CRON_SECRET set, only Vercel's call (Authorization: Bearer <secret>) runs it.
// Without it, calling it is still harmless: a business is only checked when
// its last check is ~20 hours old, and the agent never raises spend on its own.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120; // new businesses start only in the first ~50s

const PER_RUN = 25;
const TIME_BUDGET_MS = 50_000;
const MIN_GAP_MS = 20 * 60 * 60 * 1000;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const got = Buffer.from(req.headers.get("authorization") || "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ ok: false }, { status: 401 });

  const started = Date.now();
  const due = (await listAgentBusinesses(200)).filter((b) => !b.agentRanAt || Date.now() - Date.parse(b.agentRanAt) >= MIN_GAP_MS);
  const counts = { ran: 0, skipped: 0, failed: 0 };
  for (const b of due) {
    if (counts.ran + counts.failed >= PER_RUN || Date.now() - started > TIME_BUDGET_MS) break;
    try {
      const owner = await getUserById(b.userId);
      if (!owner || !limitsFor(owner).autoMarketing) {
        // Not in their plan now: move it to the back of the line without working on it.
        await markAgentRan(b.id);
        counts.skipped++;
        continue;
      }
      await runDaily(b.id);
      counts.ran++;
    } catch (err) {
      counts.failed++;
      console.error("[cron/agent] business failed", b.id, (err as Error)?.message);
      await markAgentRan(b.id).catch(() => {});
    }
  }
  return NextResponse.json({ ok: true, due: due.length, ...counts });
}
