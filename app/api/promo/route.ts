import { NextResponse } from "next/server";
import { validCode } from "@/lib/billing";
import { allow, clientIp } from "@/lib/guard";
import { cleanCode } from "@/lib/plans";

// sevrii.com/precios: is this discount code valid? Only says yes or no, and is
// limited per connection so codes can't be guessed.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const code = cleanCode(new URL(req.url).searchParams.get("code"));
  if (!code) return NextResponse.json({ ok: false });
  if (!(await allow(`promo:${await clientIp()}`, 15, 60 * 60))) return NextResponse.json({ ok: false, error: "rate" }, { status: 429 });
  return NextResponse.json({ ok: validCode(code) }, { headers: { "Cache-Control": "no-store" } });
}
