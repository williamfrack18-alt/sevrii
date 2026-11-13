// Someone chose to pay for Starter before having an account ("Elegir Starter"
// on sevrii.com/precios): the choice is kept through sign-up or log-in (with
// email or Google) so they go straight to paying instead of starting free.
export const BUY_COOKIE = "sevrii_buy";

export type BuyInterval = "month" | "year";

export function readBuy(v: string | null | undefined): BuyInterval | null {
  const x = (v ?? "").replace(/^starter:/, "");
  return x === "year" ? "year" : x === "month" ? "month" : null;
}

export function buyCookieValue(interval: BuyInterval): string {
  return `starter:${interval}`;
}

// Where to go right after signing up or logging in: to pay, if they chose it.
export function afterAuthPath(cookieValue: string | undefined, fallback: string): string {
  const interval = readBuy(cookieValue);
  return interval ? `/comprar?billing=${interval}` : fallback;
}
