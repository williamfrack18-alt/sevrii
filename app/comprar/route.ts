import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { AlreadySubscribed, billingReady, createCheckoutUrl, effectivePlan, siteUrl } from "@/lib/billing";
import { BUY_COOKIE, buyCookieValue, readBuy } from "@/lib/buyIntent";
import { cleanCode } from "@/lib/plans";

export const dynamic = "force-dynamic";

// "Elegir" (quarterly, half-yearly or yearly) on sevrii.com/precios: someone who wants to pay goes
// straight to paying. Without an account: it is remembered through sign-up or
// log-in, and right after that this route opens Stripe. With an account: Stripe
// opens now. (Nothing is charged here: Stripe's own page asks for the card.)
export async function GET(req: Request) {
  const url = new URL(req.url);
  const interval = readBuy(url.searchParams.get("billing")) ?? "quarter";
  // A discount code typed on the prices page (checked again when paying).
  const code = cleanCode(url.searchParams.get("code"));
  const user = await getCurrentUser().catch(() => null);
  const go = (path: string) => {
    const res = NextResponse.redirect(path.startsWith("http") ? path : `${siteUrl()}${path}`, 303);
    return res;
  };
  if (!user) {
    const res = go("/signup");
    res.cookies.set(BUY_COOKIE, buyCookieValue(interval, code), { path: "/", maxAge: 60 * 60, sameSite: "lax", httpOnly: true, secure: true });
    return res;
  }
  const done = (path: string) => {
    const res = go(path);
    res.cookies.delete(BUY_COOKIE);
    return res;
  };
  // Already on a paid plan, or payments not set up on Sevrii yet: the Plans page says so.
  if (effectivePlan(user) !== "free") return done(user.business ? "/dashboard?view=plans" : "/start");
  if (!billingReady()) return done(user.business ? "/dashboard?view=plans" : "/start");
  try {
    // Someone who just signed up has no project yet: after paying they land
    // on the first step (what they'll create), with their plan already on.
    const after = user.business ? undefined : "/start?checkout=success&session_id={CHECKOUT_SESSION_ID}";
    const cancel = user.business ? undefined : "/start";
    return done(await createCheckoutUrl(user, interval, { successPath: after, cancelPath: cancel, code }));
  } catch (err) {
    if (err instanceof AlreadySubscribed) return done(user.business ? "/dashboard?view=plans&checkout=success" : "/start");
    console.error("[comprar] checkout failed", (err as Error)?.message);
    return done(user.business ? "/dashboard?view=plans" : "/start");
  }
}
