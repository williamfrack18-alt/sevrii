import { cleanCode, readBilling, type Billing } from "./plans";

// Someone chose to pay for Starter before having an account ("Elegir" on
// sevrii.com/precios): the choice (and a discount code, if they typed one) is
// kept through sign-up or log-in (email or Google) so they go straight to
// paying instead of starting free.
export const BUY_COOKIE = "sevrii_buy";

export type BuyInterval = Billing;

export function readBuy(v: string | null | undefined): BuyInterval | null {
  return readBilling((v ?? "").replace(/^starter:/, "").split(":")[0]);
}

export function readBuyCode(v: string | null | undefined): string {
  return cleanCode((v ?? "").replace(/^starter:/, "").split(":")[1]);
}

export function buyCookieValue(interval: BuyInterval, code = ""): string {
  const c = cleanCode(code);
  return `starter:${interval}${c ? `:${c}` : ""}`;
}

// Where to go right after signing up or logging in: to pay, if they chose it.
export function afterAuthPath(cookieValue: string | undefined, fallback: string): string {
  const interval = readBuy(cookieValue);
  const code = readBuyCode(cookieValue);
  return interval ? `/comprar?billing=${interval}${code ? `&code=${encodeURIComponent(code)}` : ""}` : fallback;
}
