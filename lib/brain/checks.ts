// Mechanical checks around the Brain (no AI): what the owner really said,
// what may reach the owner's screen, and what a reply may ask. They run on
// every turn in code, so they hold even when a long chat makes the model
// forget its instructions.

import type { BusinessPlan, PlanPackage as Package, PriceRange } from "../plan";

const fold = (x: string) => x.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// ---------- numbers the owner really said ----------
const WORDS: Record<string, number> = {
  cero: 0, zero: 0, un: 1, uno: 1, una: 1, one: 1, dos: 2, two: 2, tres: 3, three: 3, cuatro: 4, four: 4, cinco: 5, five: 5,
  seis: 6, six: 6, siete: 7, seven: 7, ocho: 8, eight: 8, nueve: 9, nine: 9, diez: 10, ten: 10, once: 11, eleven: 11,
  doce: 12, twelve: 12, quince: 15, fifteen: 15, veinte: 20, twenty: 20, veinticinco: 25, treinta: 30, thirty: 30,
  cuarenta: 40, forty: 40, cincuenta: 50, fifty: 50, sesenta: 60, sixty: 60, cien: 100, hundred: 100, mil: 1000,
};
const NOTHING = /\b(nada|cero|ninguno|ninguna|gratis|free|nothing|none|no tengo|casi nada|\$\s?0)\b/;

// Every number written in a text (digits, "1,500", "1.5", "$100", "veinte").
export function numbersIn(text: string): number[] {
  const t = fold(text);
  const out = [...t.matchAll(/\d+(?:[.,]\d{3})*(?:[.,]\d+)?/g)].map((m) => {
    const raw = m[0];
    // "1,500" / "1.500" are thousands; "1,5" / "1.5" are decimals.
    const thousands = /^\d{1,3}([.,]\d{3})+$/.test(raw);
    return Number(thousands ? raw.replace(/[.,]/g, "") : raw.replace(",", "."));
  });
  for (const w of t.split(/[^a-z]+/)) if (w in WORDS) out.push(WORDS[w]);
  // "medio" alone is never a number: "medio tiempo" must be asked.
  return out.filter((n) => Number.isFinite(n));
}

// Did the owner state this number? (0 also when they said "nada", "gratis"…)
export function ownerStated(n: number, ownerText: string, zeroOk = false): boolean {
  if (n === 0 && zeroOk && NOTHING.test(fold(ownerText))) return true;
  return numbersIn(ownerText).some((x) => Math.abs(x - n) < 0.01);
}

// Profile fields that are numbers: saved only if the owner said them.
export const OWNER_NUMBERS: Record<string, { zeroOk: boolean; ask: string }> = {
  hoursPerWeek: { zeroOk: false, ask: "how many hours a week (a number)" },
  startBudgetUsd: { zeroOk: true, ask: "how much money they have to start (a number, 0 is fine)" },
  radiusMiles: { zeroOk: false, ask: "how many miles they travel (a number)" },
  yearsExperience: { zeroOk: true, ask: "how many years doing this work (a number)" },
  yearsOwnBusiness: { zeroOk: true, ask: "how many of those years on their own (a number, 0 if starting)" },
  costHoursPerJob: { zeroOk: false, ask: "how many hours one job (or one client a month) takes them" },
  costMaterialsUsd: { zeroOk: true, ask: "how many dollars of materials or tools per job (0 is fine if they said free)" },
};

// ---------- what may reach the owner's screen ----------
// Words of our own machinery: field names, review notes, internal labels.
const JARGON =
  /(market\.|market\.competitors|profile\.|packages\[|pricingNote|forNewClients|endsAt|\bjson\b|\bguard\b|guardi[aá]n|nota interna|notas internas|propuesta interna|suposici[oó]n(es)? tuya|tu c[aá]lculo|tu estimado de costos|no vinieron del due[nñ]o|sin su confirmaci[oó]n|no hagas|no puedes incluir|no va en la propuesta|tarjeta mostrada|card shown|internal note|your assumption|the owner (did not|didn't))/i;
// Customer-facing texts (the proposal, the page) can't say "expediente" either.
export function hasJargon(text: string, customerFacing = false): boolean {
  return JARGON.test(text || "") || (customerFacing && /\bexpediente\b/i.test(text || ""));
}

// The one market range the owner ever sees ("de $300 a $7,000+ por mes"):
// from the lowest price to the highest, never a range of ranges.
export function marketRangeText(p: PriceRange | null, lang: "es" | "en"): string {
  if (!p) return "";
  const pair = (a: string, b: string) => (lang === "es" ? `de ${a} a ${b}` : `${a} to ${b}`);
  const lo = p.low || p.mid || "";
  const hi = p.high || p.mid || "";
  if (!lo || !hi || lo === hi) return lo || hi;
  const AMT = /\$\s?[\d,.]+\+?/g;
  const first = lo.match(AMT)?.[0];
  const all = hi.match(AMT);
  const last = all?.[all.length - 1];
  if (!first || !last) return pair(lo, hi);
  const unitOf = (x: string, amt: string) => x.slice(x.lastIndexOf(amt) + amt.length).replace(/^[\s+]+/, "").trim();
  const unit = unitOf(hi, last);
  const loAll = lo.match(AMT) ?? [];
  const loUnit = unitOf(lo, loAll[loAll.length - 1] ?? first);
  if (loUnit && unit && loUnit !== unit) return pair(`${first} ${loUnit}`, `${last} ${unit}`);
  return `${pair(first, last)}${unit ? ` ${unit}` : ""}`;
}

const dollars = (t: string) => [...(t || "").matchAll(/\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?/g)].map((m) => Number(m[1].replace(/,/g, "")));

// Amounts the proposal may quote: its packages, the research and the owner's own numbers.
export function knownAmounts(plan: BusinessPlan, packages: Package[] = plan.packages): Set<number> {
  const p = plan.profile;
  const own = [p.currentPrice, p.costs, `$${p.startBudgetUsd ?? ""}`, `$${p.costMaterialsUsd ?? ""}`].join(" ");
  const pk = packages.flatMap((k) => dollars(`${k.price} ${k.includes} ${k.note}`));
  const base = new Set<number>([...pk, ...dollars(JSON.stringify(plan.market.prices ?? {})), ...dollars(JSON.stringify(plan.market.competitors ?? [])), ...dollars(own)]);
  // Discounted prices of the offer ("10 % → $135") are fine too.
  const pct = Number(/(\d{1,2})\s*%/.exec(`${plan.offer?.label ?? ""} ${plan.offer?.detail ?? ""}`)?.[1] ?? 0);
  if (pct) for (const n of pk) base.add(Math.round(n * (100 - pct)) / 100), base.add(Math.round((n * (100 - pct)) / 100));
  return base;
}

// Hours the proposal may state: only the owner's.
function hourMentions(text: string): number[] {
  return [...fold(text || "").matchAll(/(\d+(?:[.,]\d+)?)\s*(h\b|hrs?\b|horas?\b|hours?\b)/g)].map((m) => Number(m[1].replace(",", ".")));
}

// What's wrong with a proposal before the owner sees it, checked by code. The
// lines go to the Strategist (to fix it in silence), never to the owner.
export function silentProposalIssues(plan: BusinessPlan): string[] {
  const out: string[] = [];
  const known = knownAmounts(plan);
  const ownerHours = [plan.profile.costHoursPerJob, plan.profile.hoursPerWeek].filter((x): x is number => x !== null);
  const texts: [string, string][] = [
    ["promise", plan.promise],
    ["pricingNote", plan.pricingNote],
    ["serviceIncludes", plan.serviceIncludes],
    ...plan.differentiators.map((d, i): [string, string] => [`differentiators[${i}]`, d]),
    ...plan.packages.map((k, i): [string, string] => [`packages[${i}]`, `${k.includes} ${k.note}`]),
    ...plan.faq.map((f, i): [string, string] => [`faq[${i}]`, `${f.q} ${f.a}`]),
    ["offer", `${plan.offer?.label ?? ""} ${plan.offer?.detail ?? ""}`],
  ];
  for (const [where, t] of texts) {
    if (!t) continue;
    const bad = dollars(t).filter((n) => !known.has(n));
    if (bad.length) out.push(`${where} quotes $${bad.join(", $")}, which is not a package price, a research price or a number the owner gave. Use only those.`);
    const hrs = hourMentions(t).filter((h) => !ownerHours.some((o) => Math.abs(o - h) < 0.01));
    if (hrs.length) out.push(`${where} states ${hrs.join(", ")} hours that the owner never gave. Use only the owner's hours (${ownerHours.join(", ") || "none given"}) or don't state hours.`);
    if (hasJargon(t, true)) out.push(`${where} uses internal words (field names, "expediente", notes about the owner). Write it for the customer.`);
  }
  return out;
}

// ---------- what a reply may say ----------
// One question per message: everything after the first question goes.
export function oneQuestion(reply: string): string {
  const parts = reply.split(/(?<=[.!?])\s+/);
  const firstQ = parts.findIndex((x) => /\?\s*$/.test(x.trim()));
  if (firstQ < 0) return reply;
  const later = parts.slice(firstQ + 1).filter((x) => !/\?\s*$/.test(x.trim()));
  return [...parts.slice(0, firstQ + 1), ...later].join(" ").trim();
}

// "Te repito las preguntas" when nothing was asked before: the claim goes.
export function noRepeatClaims(reply: string): string {
  return reply
    .replace(/(^|\s)(te (las |lo |la )?repito|vuelvo a pregunt\w+|otra vez te pregunto|te lo pregunto de nuevo|como te pregunt[eé])[^.?!:]*[:.]?\s*/gi, " ")
    .replace(/(^|\s)(let me (ask|repeat)( (it|that|them))? again|i'?ll repeat|as i asked)[^.?!:]*[:.]?\s*/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// The owner asked something, or says they don't understand: answer it, don't
// push the script.
const ASKS = /(\?|no entend|no le entend|expl[ií]ca|qu[eé] (es|significa|quiere decir)|por qu[eé]|c[oó]mo as[ií]|a qu[eé] te refieres|qu[eé] me enviaste|lo que (te|me) envi|don'?t understand|explain|what (does|is|do you mean)|why)/i;
export function isQuestionTurn(msg: string): boolean {
  return ASKS.test(msg || "");
}
// The approval script at the end of a reply ("¿La apruebas así?").
export function dropApprovalScript(reply: string): string {
  return reply.replace(/\s*¿[^?¿]*(apruebas|apruebo|aprobamos|la dejas|lo dejo as[ií]|cambiar[ií]as|te parece bien así)[^?]*\?\s*$/i, "").replace(/\s*\b(Do you approve|Shall I keep it)[^?]*\?\s*$/i, "").trim();
}

// ---------- prices are locked ----------
// A package price changes only when the owner says the new amount, or says yes
// right after the Brain proposed exactly that amount.
export function priceChangeAllowed(before: Package[], after: Package[], ownerLast: string, lastAssistant: string, saidYes: boolean): { ok: boolean; changed: number[] } {
  const was = new Set(before.flatMap((k) => dollars(k.price)));
  const changed = [...new Set(after.flatMap((k) => dollars(k.price)))].filter((n) => !was.has(n));
  if (!changed.length) return { ok: true, changed };
  const ownerNums = numbersIn(ownerLast);
  const proposed = new Set(dollars(lastAssistant));
  const ok = changed.every((n) => ownerNums.includes(n) || (saidYes && proposed.has(n)));
  return { ok, changed };
}
