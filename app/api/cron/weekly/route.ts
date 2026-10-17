import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { businessWeekNumbers, campaignStats, claimWeekly, getBusinessById, getUserById, listCampaigns, listWeeklyDue, type CampaignStats } from "@/lib/db";
import { limitsFor } from "@/lib/billing";
import { emailReady } from "@/lib/email";
import { sendWeeklySummary, type WeeklyCampaign } from "@/lib/notify";

// Monday weekly summary, called by Vercel Cron (see vercel.json).
// With CRON_SECRET set, only Vercel's call (Authorization: Bearer <secret>) runs it.
// Without it, calling it is still harmless: claimWeekly() lets each business
// get at most one summary every 6 days.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PER_RUN = 50;
const TIME_BUDGET_MS = 45_000;
const DAY = 24 * 60 * 60 * 1000;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const got = Buffer.from(req.headers.get("authorization") || "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

const ZERO: CampaignStats = { views: 0, chats: 0, contacts: 0 };
const minus = (a: CampaignStats, b: CampaignStats): CampaignStats => ({
  views: Math.max(0, a.views - b.views),
  chats: Math.max(0, a.chats - b.chats),
  contacts: Math.max(0, a.contacts - b.contacts),
});
const active = (s: CampaignStats) => s.views + s.chats + s.contacts > 0;

type Outcome = "sent" | "skipped" | "failed" | "taken";

async function runOne(businessId: string): Promise<Outcome> {
  // Claimed first, even when it ends up skipped, so a business that gets no
  // email doesn't stay at the front of the queue every run.
  if (!(await claimWeekly(businessId))) return "taken";
  const business = await getBusinessById(businessId);
  if (!business || business.site.notifyEmail === false) return "skipped";
  const owner = await getUserById(business.userId);
  if (!owner?.email || !limitsFor(owner).canPublish) return "skipped";

  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * DAY);
  const twoWeeksAgo = new Date(now.getTime() - 14 * DAY);
  const [week, prev, campaigns, last7, last14] = await Promise.all([
    businessWeekNumbers(business.id, weekAgo, now),
    businessWeekNumbers(business.id, twoWeeksAgo, weekAgo),
    listCampaigns(business.id),
    campaignStats(business.id, weekAgo),
    campaignStats(business.id, twoWeeksAgo),
  ]);
  const rows: WeeklyCampaign[] = campaigns
    .map((c) => {
      const w = last7[c.id] ?? ZERO;
      return { title: c.title, week: w, prev: minus(last14[c.id] ?? ZERO, w) };
    })
    .filter((c) => active(c.week) || active(c.prev))
    .sort((a, b) => b.week.contacts - a.week.contacts || b.week.chats - a.week.chats || b.week.views - a.week.views);

  const ok = await sendWeeklySummary(business, owner.email, { week, prev, campaigns: rows, campaignCount: campaigns.length });
  return ok ? "sent" : "failed";
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ ok: false }, { status: 401 });
  // Without email set up, nothing is claimed (the week isn't used up for nothing).
  if (!emailReady()) return NextResponse.json({ ok: true, skipped: "email not configured" });

  const started = Date.now();
  const due = await listWeeklyDue(PER_RUN);
  const counts: Record<Outcome, number> = { sent: 0, skipped: 0, failed: 0, taken: 0 };
  for (const b of due) {
    if (Date.now() - started > TIME_BUDGET_MS) break;
    try {
      counts[await runOne(b.id)]++;
    } catch (err) {
      counts.failed++;
      console.error("[cron/weekly] business failed", b.id, (err as Error)?.message);
    }
  }
  return NextResponse.json({ ok: true, due: due.length, ...counts });
}
