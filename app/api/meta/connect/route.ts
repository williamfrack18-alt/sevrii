import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { limitsFor, siteUrl } from "@/lib/billing";
import { allow } from "@/lib/guard";
import { META_STATE_COOKIE, META_STATE_MAX_AGE, metaDialogUrl, metaReady, newMetaState } from "@/lib/meta";

export const dynamic = "force-dynamic";

// Step 1: send the owner to Facebook to connect their ad account and page.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const home = siteUrl();
  const back = (meta: string) => NextResponse.redirect(new URL(`/dashboard?view=marketing&meta=${meta}`, url.origin));
  if (!metaReady()) return back("off");

  // Facebook sends people back to siteUrl(); start there so the state cookie
  // (and the session) live on the same domain as the return trip.
  if (new URL(home).origin !== url.origin) return NextResponse.redirect(`${home}/api/meta/connect`);

  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", url.origin));
  if (!user.business || !limitsFor(user).marketing) return back("plan");
  if (!(await allow(`meta:connect:${user.id}`, 10, 15 * 60))) return back("busy");

  const s = newMetaState(user.business.id);
  (await cookies()).set(META_STATE_COOKIE, JSON.stringify(s), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: META_STATE_MAX_AGE,
    path: "/api/meta",
  });
  return NextResponse.redirect(metaDialogUrl(s.state));
}
