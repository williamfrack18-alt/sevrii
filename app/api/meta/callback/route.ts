import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { limitsFor } from "@/lib/billing";
import { getBusinessForUser, saveMetaConnection, setMetaAssets } from "@/lib/db";
import { encryptToken, exchangeMetaCode, META_STATE_COOKIE, metaReady, sameState, type MetaState } from "@/lib/meta";

export const dynamic = "force-dynamic";

// Step 2: Facebook sends the owner back here with a one-time code.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const jar = await cookies();
  const raw = jar.get(META_STATE_COOKIE)?.value;
  jar.delete({ name: META_STATE_COOKIE, path: "/api/meta" });
  const back = (meta: string) => NextResponse.redirect(new URL(`/dashboard?view=marketing&meta=${meta}`, url.origin));

  let saved: MetaState | null = null;
  try {
    saved = raw ? (JSON.parse(raw) as MetaState) : null;
  } catch {
    saved = null;
  }
  if (!metaReady()) return back("off");
  // The owner closed the window or said no.
  if (url.searchParams.get("error")) return back("cancel");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!saved || typeof saved.state !== "string" || !code || !state || code.length > 2048 || !sameState(state, saved.state)) return back("error");

  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", url.origin));
  const business = typeof saved.businessId === "string" ? await getBusinessForUser(user.id, saved.businessId) : undefined;
  if (!business || !limitsFor(user).marketing) return back("error");

  try {
    const login = await exchangeMetaCode(code);
    await saveMetaConnection({
      businessId: business.id,
      userId: user.id,
      tokenEnc: encryptToken(login.token),
      expiresAt: login.expiresAt,
      fbUserName: login.name,
    });
    // A new login may be a different Facebook user: choose the account and page again.
    await setMetaAssets(business.id, { adAccountId: "", adAccountName: "", pageId: "", pageName: "" });
    return back("connected");
  } catch (err) {
    console.error("[meta] connect failed", String((err as Error)?.message || "").slice(0, 200));
    return back("error");
  }
}
