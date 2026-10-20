import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { siteUrl } from "@/lib/billing";

export const dynamic = "force-dynamic";

// "Crear mi agente" on sevrii.com: remembers the choice for a while (through
// sign-up or log-in) and opens the start screen with "Create an agent" picked.
export async function GET() {
  const user = await getCurrentUser().catch(() => null);
  const base = siteUrl();
  const to = !user ? "/signup" : user.business ? "/start?new=1&path=agent" : "/start?path=agent";
  const res = NextResponse.redirect(`${base}${to}`, 303);
  res.cookies.set("sevrii_path", "agent", { path: "/", maxAge: 60 * 60, sameSite: "lax", httpOnly: true, secure: true });
  return res;
}
