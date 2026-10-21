import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { siteUrl } from "@/lib/billing";

export const dynamic = "force-dynamic";

// "Quiero ser afiliado" on sevrii.com: remembers the choice through sign-up
// or log-in and opens the affiliate panel (no project needed).
export async function GET() {
  const user = await getCurrentUser().catch(() => null);
  const res = NextResponse.redirect(`${siteUrl()}${user ? "/panel-afiliado" : "/signup"}`, 303);
  res.cookies.set("sevrii_path", "affiliate", { path: "/", maxAge: 60 * 60, sameSite: "lax", httpOnly: true, secure: true });
  return res;
}
