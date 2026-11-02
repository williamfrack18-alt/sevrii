// Mechanical checks around the Brain (no AI): what the owner really said,
// what may reach the owner's screen, and what a reply may ask. They run on
// every turn in code, so they hold even when a long chat makes the model
// forget its instructions.

import type { BusinessPlan, PlanPackage as Package, PriceRange } from "../plan";
import { stripReasoning } from "../pageText";

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
  const t0 = fold(text);
  // "hora y media" = 1.5, "dos horas y media" = 2.5, "media hora" = 0.5,
  // "hora y cuarto" = 1.25 (said in words, they are still the owner's numbers).
  const halves: number[] = [];
  const t = t0
    .replace(/\b(\d+|una?|dos|tres|cuatro|cinco|seis|siete|ocho)?\s*horas?\s+y\s+(media|cuarto)\b/g, (_m, n: string | undefined, part: string) => {
      const base = n === undefined ? 1 : /^\d+$/.test(n) ? Number(n) : (WORDS[n] ?? 1);
      halves.push(base + (part === "media" ? 0.5 : 0.25));
      return " ";
    })
    .replace(/\bmedia\s+hora\b/g, () => {
      halves.push(0.5);
      return " ";
    })
    .replace(/\b(\d+)\s+and\s+a\s+half\s+hours?\b|\b(an?|one)\s+hour\s+and\s+a\s+half\b/g, (_m, n: string | undefined) => {
      halves.push((n ? Number(n) : 1) + 0.5);
      return " ";
    });
  const out = [...t.matchAll(/\d+(?:[.,]\d{3})*(?:[.,]\d+)?/g)].map((m) => {
    const raw = m[0];
    // "1,500" / "1.500" are thousands; "1,5" / "1.5" are decimals.
    const thousands = /^\d{1,3}([.,]\d{3})+$/.test(raw);
    return Number(thousands ? raw.replace(/[.,]/g, "") : raw.replace(",", "."));
  });
  for (const w of t.split(/[^a-z]+/)) if (w in WORDS) out.push(WORDS[w]);
  // "medio" alone is never a number: "medio tiempo" must be asked.
  return [...out, ...halves].filter((n) => Number.isFinite(n));
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
  /(market\.|market\.competitors|profile\.|packages\[|pricingNote|forNewClients|endsAt|\bjson\b|\bguard\b|guardi[aá]n|nota interna|notas internas|propuesta interna|suposici[oó]n(es)? tuya|tu c[aá]lculo|tu estimado de costos|no vinieron del due[nñ]o|sin su confirmaci[oó]n|no hagas|no puedes incluir|no va en la propuesta|tarjeta mostrada|card shown|internal note|your assumption|the owner (did not|didn't)|el sistema no (me )?(deja|permite)|no me deja guardar|no (lo |la )?puedo guardar|no se puede guardar|the system (won'?t|doesn'?t|does not) (let|allow)|i can'?t save)/i;
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

// A chat reply quotes only amounts that exist: the packages, the research,
// the owner's own numbers. A sentence with any other amount is left out.
export function unknownAmountSentences(reply: string, plan: BusinessPlan, ownerSaid: string): string {
  const known = knownAmounts(plan);
  for (const n of dollars(ownerSaid)) known.add(n);
  for (const n of numbersIn(ownerSaid)) known.add(n);
  const parts = reply.split(/(?<=[.!?])\s+/);
  const kept = parts.filter((x) => dollars(x).every((n) => known.has(n)));
  return kept.length === parts.length ? reply : kept.join(" ").trim();
}

// Hours the proposal may state: only the owner's.
function hourMentions(text: string): number[] {
  return [...fold(text || "").matchAll(/(\d+(?:[.,]\d+)?)\s*(h\b|hrs?\b|horas?\b|hours?\b)/g)].map((m) => Number(m[1].replace(",", ".")));
}

// What's wrong with a proposal before the owner sees it, checked by code. The
// lines go to the Strategist (to fix it in silence), never to the owner.
export function silentProposalIssues(plan: BusinessPlan, ownerSaid = ""): string[] {
  const out: string[] = [];
  const known = knownAmounts(plan);
  // Hours the owner gave: in the profile, or said in the chat ("dura 1 hora").
  const ownerHours = [plan.profile.costHoursPerJob, plan.profile.hoursPerWeek, ...hourMentions(ownerSaid), ...numbersIn(ownerSaid)].filter((x): x is number => x !== null);
  const texts: [string, string][] = [
    ["promise", plan.promise],
    ["pricingNote", plan.pricingNote],
    ["serviceIncludes", plan.serviceIncludes],
    ...plan.firstSteps.map((x, i): [string, string] => [`firstSteps[${i}]`, x]),
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
  // A discount the owner never asked for: not in the offer, not anywhere else.
  if (!plan.profile.offerWanted) {
    if (plan.offer) out.push("There is an offer, but the owner never asked for a discount or promotion. Remove it (no offer).");
    const all: [string, string][] = [...texts, ["videoScript", plan.videoScript], ["steps", plan.steps.join(" ")], ["campaignType", plan.campaignType]];
    for (const [where, t] of all) if (t && where !== "offer" && mentionsDiscount(t)) out.push(`${where} mentions a discount or promotion the owner never asked for. Remove it.`);
  }
  return out;
}

// Discounts and promotions ("15 % de descuento", "primera clase gratis", "% off").
const DISCOUNT = /(\d+\s?%\s?(de\s+)?(descuento|off|menos)|descuento|\bpromo(ci[oó]n)?\b|discount|\b\d+\s?% off|(primera?|first)\s+\w+(\s+\w+)?\s+(gratis|free))/i;
export function mentionsDiscount(text: string): boolean {
  return DISCOUNT.test(text || "");
}
// Removes every sentence about a discount (and the offer) from a proposal.
export function withoutDiscounts(plan: BusinessPlan): BusinessPlan {
  const cut = (t: string) => (mentionsDiscount(t) ? t.split(/(?<=[.!?])\s+/).filter((x) => !mentionsDiscount(x)).join(" ").trim() : t);
  return {
    ...plan,
    offer: null,
    promise: cut(plan.promise),
    pricingNote: cut(plan.pricingNote),
    serviceIncludes: cut(plan.serviceIncludes),
    videoScript: cut(plan.videoScript),
    campaignType: cut(plan.campaignType),
    steps: plan.steps.map(cut).filter(Boolean),
    differentiators: plan.differentiators.map(cut).filter(Boolean),
    packages: plan.packages.map((k) => ({ ...k, includes: cut(k.includes), note: cut(k.note) })),
    faq: plan.faq.filter((f) => !mentionsDiscount(`${f.q} ${f.a}`)),
  };
}
// The owner asking for one, in their own words.
export const ASKS_OFFER = /(descuento|oferta|promoci|promo\b|discount|\boffer\b|% off|\d+\s?%|gratis la primera|first (one|class|session|week) free)/i;

// ---------- what a reply may say ----------
// One question per message: everything after the first question goes.
export function oneQuestion(reply: string): string {
  const parts = reply.split(/(?<=[.!?])\s+/);
  const firstQ = parts.findIndex((x) => /\?\s*$/.test(x.trim()));
  if (firstQ < 0) return reply;
  // A second request in disguise ("Y cuando puedas, dime también…") goes too.
  const ASK_MORE = /^(y\s+)?(cuando puedas,?\s+)?(dime|cu[eé]ntame|av[ií]same|tell me|let me know)\b/i;
  const later = parts.slice(firstQ + 1).filter((x) => !/\?\s*$/.test(x.trim()) && !ASK_MORE.test(x.trim()));
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


// ---------- internal notes never reach the owner ----------
// The model sometimes echoes the notes and rules we give it: "(Internal note…)",
// "(Nota interna…)", "(Reglas de siempre…)", "(Sistema…)", tool or field names.
const NOTE_PAREN = /\(\s*(internal note|nota interna|notas? del sistema|system|sistema|reglas? de siempre|rules?|tarjeta mostrada|card shown|recordatorio|reminder)[^)]*\)/gi;
const NOTE_LINE = /^\s*(internal note|nota interna|sistema|system|reglas de siempre|note to self)\s*:.*$/gim;
const MACHINERY = /(save_profile|update_proposal|approve_blocks|choose_idea|more_ideas|own_idea|start_research|stillToAskAfterThis|essentialMissing|canResearch|ownerReplies|researchReady|\bmissing\b\s*:|\bstate\s*\(json\)|\bNOT saved\b|\bwas not saved\b|\b(hoursPerWeek|startBudgetUsd|costHoursPerJob|costMaterialsUsd|yearsExperience|yearsOwnBusiness|offerWanted|workLocation|serviceMode|remoteScope|businessName|currentPrice|mainService|typicalCustomer|howGetsClients|workHistory|askedFor|notWant|hasVehicle|workPlace|ideasNow|toolsReady|exampleJob)\b)/i;
// Returns the reply without our machinery; `leaked` says whether anything was cut
// (the caller may then regenerate silently).
export function scrubInternal(reply: string): { reply: string; leaked: boolean } {
  let leaked = false;
  let t = reply.replace(NOTE_PAREN, () => ((leaked = true), "")).replace(NOTE_LINE, () => ((leaked = true), ""));
  const parts = t.split(/(?<=[.!?])\s+/);
  const kept = parts.filter((x) => !MACHINERY.test(x));
  if (kept.length !== parts.length) leaked = true;
  t = kept.join(" ").replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return { reply: t, leaked };
}

// ---------- what the owner never wants (a hard filter) ----------
const AVOID_STOP = new Set(
  ("nunca quiero quieres volver hacer hacerlo odio odias detesto detestas trabajo trabajos trabajar algo cosas cosa como para cuando porque tengo tener estar desde hasta tampoco jamas nada mucho mucha muy " +
    "gente personas cliente clientes tiempo ganas poder puedo pienso creo sobre entre ellos ellas esto esta este eso esas esos otra otro tipo ningun ninguna ninguno " +
    "todo toda todos todas dias largo larga largos largas mismo misma siempre bajo concepto ningun alguna alguno " +
    "never want again hate doing work anything about with from have would like thing things people customer customers that this all day days long").split(" ")
);
const stem = (w: string) => (w.length > 5 ? w.slice(0, 5) : w);
const wordsOf = (t: string) => fold(t).split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
// Stems of the words the owner used to say what they don't want.
// Each thing they named is one entry ("vender por teléfono" → "vende+telef"):
// a text touches it only when it has every word of that entry, so a limit on
// phone sales doesn't wipe out every idea that sells something.
export function avoidTerms(notWant: string): string[] {
  const nothing = /^\s*(nada|ninguno|ninguna|no hay|none|nothing|n\/?a|nada en especial|nothing in particular)\b/i.test(fold(notWant).trim());
  if (nothing) return [];
  const phrases = fold(notWant).split(/[,;\n]|\s+(?:y|ni|o|and|or|nor)\s+/);
  const out = phrases.map((ph) => [...new Set(wordsOf(ph).filter((w) => !AVOID_STOP.has(w)).map(stem))].join("+")).filter(Boolean);
  return [...new Set(out)];
}
export function touchesAvoid(text: string, terms: string[]): boolean {
  if (!terms.length) return false;
  const ws = wordsOf(text);
  const has = (t: string) => ws.some((w) => (t.length < 5 ? w === t : w.startsWith(t)));
  return terms.some((entry) => entry.split("+").every(has));
}
// A sentence that SUGGESTS something the owner never wants ("te propongo limpieza…").
const SUGGESTS = /(te (propongo|sugiero|recomiendo)|podr[ií]as|puedes ofrecer|una idea|opci[oó]n|ofrecer|\bprueba\b|propon|sugier|i suggest|you could|how about|idea|option|offer)/i;
export function withoutAvoidedSuggestions(reply: string, notWant: string): string {
  const terms = avoidTerms(notWant);
  if (!terms.length) return reply;
  return reply
    .split(/(?<=[.!?])\s+/)
    .filter((x) => !(SUGGESTS.test(fold(x)) && touchesAvoid(x, terms)))
    .join(" ")
    .trim();
}

// A saved free-text answer must come from the owner: it shares words with what
// they wrote, or it is a plain "nothing" that they also said.
export function groundedInOwner(value: string, ownerText: string): boolean {
  const v = fold(value).trim();
  const o = fold(ownerText);
  if (/^(ninguno|ninguna|nada|nada en especial|no hay|none|nothing|n\/?a)\b/.test(v)) return /\b(ninguno|ninguna|nada|no hay|nunca|none|nothing|no tengo|sin experiencia|cualquiera)\b/.test(o);
  const ownerStems = new Set(wordsOf(o).map(stem));
  return wordsOf(v).some((w) => ownerStems.has(stem(w)));
}


// ---------- gender-neutral wording for the person ----------
// The owner's gender is never guessed: "eres bueno", "estás listo" become neutral.
export function neutralGender(reply: string): string {
  return reply
    .replace(/\b(en qu[eé]|qu[eé]|con qu[eé]) (eres|te sientes) (bueno|buena|bien|c[oó]mod[oa]|segur[oa])\b/gi, (_m, a: string) => `${a} se te da bien`)
    .replace(/\b(est[aá]s|estas|ya est[aá]s|est[eé]s) (list[oa]|content[oa]|segur[oa]|ubicad[oa]|preparad[oa]|motivad[oa])\b/gi, "ya tienes lo necesario")
    .replace(/\b(bienvenid[oa])\b/gi, "bienvenida o bienvenido")
    .replace(/\bsi no est[aá]s segur[oa] o segur[oa]\b/gi, "si no lo tienes claro");
}
// A comma or colon left hanging when a question was cut out of the sentence.
export function dropDanglingClause(text: string): string {
  return text.replace(/(^|[.!?]\s+)[^.!?]*[,:]\s*$/, "$1").trim();
}

// ---------- the owner's prices vs. market references ----------
const dollarAmounts = (t: string) => [...(t || "").matchAll(/\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?/g)].map((m) => Number(m[1].replace(/,/g, "")));

// A package price is the owner's only when every amount in it is one they
// gave (on the price card, in the chat, or typed on the confirmation card).
// Anything else is a market reference and is shown as such. Checked in code
// on every proposal and every edit: the model can't present a researched
// number as "your price".
export function markReferencePrices(plan: BusinessPlan, ownerSaid = ""): BusinessPlan {
  // C's access prices are the Brain's proposal, approved part by part.
  if (plan.mode === "agent") return plan;
  const priceCard = plan.cards.prices && !plan.cards.prices.u ? plan.cards.prices.v : "";
  const own = new Set(dollarAmounts(`${plan.profile.currentPrice} ${priceCard} ${ownerSaid}`));
  return {
    ...plan,
    packages: plan.packages.map((k) => {
      const am = dollarAmounts(k.price);
      return { ...k, ref: !(am.length > 0 && am.every((n) => own.has(n))) };
    }),
  };
}

// "Tus costos" only when the owner gave costs: otherwise that sentence is a
// guess dressed as their numbers, and it goes.
const OWN_COSTS = /\b(tus|sus)\s+costos?\b|\btu\s+costo\b|\byour\s+costs?\b|\bcon tus costos\b|\bseg[uú]n tus (gastos|costos)\b/i;
export function noFakeCosts(plan: BusinessPlan): BusinessPlan {
  const gave = Boolean(plan.profile.costs?.trim()) || plan.profile.costMaterialsUsd !== null || (plan.cards.costs && !plan.cards.costs.u && plan.cards.costs.v.trim());
  if (gave) return plan;
  const cut = (t: string) => (OWN_COSTS.test(t) ? t.split(/(?<=[.!?])\s+/).filter((x) => !OWN_COSTS.test(x)).join(" ").trim() : t);
  return {
    ...plan,
    pricingNote: cut(plan.pricingNote),
    promise: cut(plan.promise),
    differentiators: plan.differentiators.map(cut).filter(Boolean),
    packages: plan.packages.map((k) => ({ ...k, includes: cut(k.includes), note: cut(k.note) })),
    faq: plan.faq.map((f) => ({ q: f.q, a: cut(f.a) })).filter((f) => f.a),
  };
}

// The approved text as it may reach the page: no reasoning for the owner,
// no invented costs.
export function readyForPage(plan: BusinessPlan): BusinessPlan {
  const p = noFakeCosts(plan);
  return {
    ...p,
    service: stripReasoning(p.service),
    serviceIncludes: stripReasoning(p.serviceIncludes),
    promise: stripReasoning(p.promise),
    customer: stripReasoning(p.customer),
    problem: stripReasoning(p.problem),
    steps: p.steps.map(stripReasoning).filter(Boolean),
    differentiators: p.differentiators.map(stripReasoning).filter(Boolean),
    packages: p.packages.map((k) => ({ ...k, includes: stripReasoning(k.includes), note: stripReasoning(k.note) })),
    faq: p.faq.map((f) => ({ q: f.q, a: stripReasoning(f.a) })).filter((f) => f.q && f.a),
  };
}

// ---------- the sacred limit, on the whole proposal ----------
// Whatever the owner NEVER wants can't be in any part of a proposal: not as a
// service, a package, a step or an answer. Found → the Strategist redoes it;
// still there → it's cut by code.
function proposalTexts(p: BusinessPlan): string[] {
  return [p.service, p.serviceIncludes, p.promise, p.customer, ...p.steps, ...p.firstSteps, ...p.differentiators, ...p.packages.map((k) => `${k.name} ${k.includes} ${k.note}`), ...p.faq.map((f) => `${f.q} ${f.a}`)];
}
export function avoidedIssue(plan: BusinessPlan): string | null {
  const terms = avoidTerms(plan.profile.notWant);
  if (!terms.length) return null;
  const hit = proposalTexts(plan).find((t) => t && touchesAvoid(t, terms));
  return hit ? `The owner NEVER wants to do "${plan.profile.notWant}", but the proposal includes it ("${hit.slice(0, 80)}"). Remove it from every part.` : null;
}
export function withoutAvoided(plan: BusinessPlan): BusinessPlan {
  const terms = avoidTerms(plan.profile.notWant);
  if (!terms.length) return plan;
  const cut = (t: string) => (touchesAvoid(t, terms) ? t.split(/(?<=[.!?;])\s+/).filter((x) => !touchesAvoid(x, terms)).join(" ").trim() : t);
  return {
    ...plan,
    serviceIncludes: cut(plan.serviceIncludes),
    promise: cut(plan.promise),
    customer: cut(plan.customer),
    steps: plan.steps.map(cut).filter(Boolean),
    firstSteps: plan.firstSteps.map(cut).filter(Boolean),
    differentiators: plan.differentiators.map(cut).filter(Boolean),
    packages: plan.packages.filter((k) => !touchesAvoid(`${k.name} ${k.includes}`, terms)).map((k) => ({ ...k, note: cut(k.note) })),
    faq: plan.faq.filter((f) => !touchesAvoid(`${f.q} ${f.a}`, terms)),
  };
}
