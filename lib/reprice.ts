// When a price changes, the old amount must not survive in texts made
// earlier (the video script, notes, FAQ). Pure, so the panel can use it too.

const AMOUNT = /\$\s?(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?/g;
export const firstAmount = (t: string) => {
  const m = /\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?/.exec(t || "");
  return m ? Number(m[1].replace(/,/g, "")) : null;
};
// Old package price → new one (same package by name, else by position).
export function priceMoves(before: { name: string; price: string }[], after: { name: string; price: string }[]): Map<number, number> {
  const moves = new Map<number, number>();
  before.forEach((old, i) => {
    const now = after.find((x) => x.name && x.name.trim().toLowerCase() === old.name.trim().toLowerCase()) ?? (after.length === before.length ? after[i] : undefined);
    const a = firstAmount(old.price);
    const b = now ? firstAmount(now.price) : null;
    if (a !== null && b !== null && a !== b) moves.set(a, b);
  });
  return moves;
}
export function swapAmounts(text: string, moves: Map<number, number>): string {
  if (!text || !moves.size) return text;
  return text.replace(AMOUNT, (m, n: string) => {
    const to = moves.get(Number(n.replace(/,/g, "")));
    return to === undefined ? m : `$${to.toLocaleString("en-US")}`;
  });
}

// The video script (written with the Brain's prices) with the prices the page
// shows now, matched by package name or position.
export function scriptWithPagePrices(script: string, packages: { name: string; price: string }[], services: { name: string; price: string | null }[]): string {
  if (!script || !packages.length || !services.length) return script;
  return swapAmounts(script, priceMoves(packages, services.map((x) => ({ name: x.name, price: x.price ?? "" }))));
}
