import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { listOpenAffiliateBusinesses } from "@/lib/db";
import { payDueCommissions, syncBusinessSales, syncRenewals } from "@/lib/affiliates";
import { paymentsReady } from "@/lib/payments";

// Daily (vercel.json): record affiliate sales whose customer never came back
// to the page, record monthly renewals, and pay commissions past their 30 days.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const got = Buffer.from(req.headers.get("authorization") || "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ ok: false }, { status: 401 });
  if (!paymentsReady()) return NextResponse.json({ ok: true, skipped: "payments off" });
  const started = Date.now();
  let recorded = 0;
  for (const b of await listOpenAffiliateBusinesses(100)) {
    if (Date.now() - started > 35_000) break;
    recorded += await syncBusinessSales(b);
  }
  const renewals = await syncRenewals(started + 60_000);
  const payouts = await payDueCommissions(started + 95_000);
  return NextResponse.json({ ok: true, recorded, renewals, ...payouts });
}
