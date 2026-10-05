// The "expediente" of one project: everything the Brain learns and decides
// about the one service it sells. Store and Marketing only read it. Pure data
// + validation, shared by the agents (server) and the UI (client).

export type PlanPackage = { name: string; price: string; includes: string; note: string };
export type PlanChannel = { channel: string; why: string };
export type PlanSource = { title: string; url: string };

// Where the project is. The code moves between stages, never the AI.
//  A (already offers): interview → research → proposal → approved
//  B (starting out):   interview → ideas_research → choose → ready_check → research → proposal → approved
export type PlanStage = "interview" | "ideas_research" | "choose" | "ready_check" | "research" | "proposal" | "approved";
export const STAGES: PlanStage[] = ["interview", "ideas_research", "choose", "ready_check", "research", "proposal", "approved"];

export type Profile = {
  businessName: string;
  city: string;
  state: string; // 2-letter US state
  radiusMiles: number | null;
  languages: "es" | "en" | "both" | "";
  yearsExperience: number | null;
  // A
  mainService: string;
  exampleJob: string;
  typicalCustomer: string;
  howGetsClients: string;
  currentPrice: string;
  costs: string;
  differentiators: string;
  // both
  licenseStatus: "has" | "no" | "not_needed" | "";
  licenseNote: string;
  insured: "yes" | "no" | "";
  // B
  workHistory: string;
  askedFor: string;
  tools: string;
  hasVehicle: "yes" | "no" | "";
  hoursPerWeek: number | null;
  startBudgetUsd: number | null;
  notWant: string;
  goal: "extra" | "fulltime" | "";
  toolsReady: "yes" | "no" | "";
};

export type PriceRange = { low: string; mid: string; high: string; includes: string; note: string };
export type Competitor = { name: string; url: string; offer: string; price: string; guarantee: string; languages: string };
export type Requirement = { item: string; applies: "yes" | "no" | "check"; link: string; note: string };
export type Faq = { q: string; a: string };

export type Market = {
  prices: PriceRange | null;
  competitors: Competitor[];
  gaps: string[];
  requirements: Requirement[];
  faq: Faq[];
  sources: PlanSource[];
  researchedAt: string; // YYYY-MM-DD
  incomplete: string[]; // research tasks that didn't finish
};

export type Idea = {
  title: string;
  why: string;
  typicalPrice: string;
  startCost: string;
  license: string; // "No" or what is required
  demand: string; // evidence of demand in the city
  pros: string;
  cons: string;
  score: number; // 0-25
  sources: PlanSource[];
};

export type ApprovalBlock = "service" | "pitch" | "packages" | "offer" | "campaign" | "faq";
export const APPROVAL_BLOCKS: ApprovalBlock[] = ["service", "pitch", "packages", "offer", "campaign", "faq"];

export type BusinessPlan = {
  mode: "existing" | "new" | "";
  stage: PlanStage;
  profile: Profile;
  market: Market;
  ideas: Idea[];
  chosenIdea: number | null;
  // Proposal (Strategist), approved block by block
  service: string;
  serviceIncludes: string;
  serviceExcludes: string;
  steps: string[]; // how the job works, for the page
  customer: string;
  problem: string;
  fears: string;
  promise: string;
  differentiators: string[];
  packages: PlanPackage[];
  pricingNote: string;
  offer: { label: string; detail: string; endsAt: string } | null; // endsAt YYYY-MM-DD, real
  noOffer: boolean;
  campaignType: string;
  channels: PlanChannel[];
  faq: Faq[];
  approvals: Partial<Record<ApprovalBlock, boolean>>;
  guard: { block: string[]; warn: string[] };
  // legacy (first Brain version) — still shown if present
  marketResearch: string;
  researchSources: PlanSource[];
  researchedAt: string;
  requirements: string[];
  nextSteps: string[];
  ready: boolean;
  approvedAt: string;
  runId: string; // current research run (pipeline)
};

export const EMPTY_PROFILE: Profile = {
  businessName: "",
  city: "",
  state: "",
  radiusMiles: null,
  languages: "",
  yearsExperience: null,
  mainService: "",
  exampleJob: "",
  typicalCustomer: "",
  howGetsClients: "",
  currentPrice: "",
  costs: "",
  differentiators: "",
  licenseStatus: "",
  licenseNote: "",
  insured: "",
  workHistory: "",
  askedFor: "",
  tools: "",
  hasVehicle: "",
  hoursPerWeek: null,
  startBudgetUsd: null,
  notWant: "",
  goal: "",
  toolsReady: "",
};

export const EMPTY_MARKET: Market = { prices: null, competitors: [], gaps: [], requirements: [], faq: [], sources: [], researchedAt: "", incomplete: [] };

export const EMPTY_PLAN: BusinessPlan = {
  mode: "",
  stage: "interview",
  profile: EMPTY_PROFILE,
  market: EMPTY_MARKET,
  ideas: [],
  chosenIdea: null,
  service: "",
  serviceIncludes: "",
  serviceExcludes: "",
  steps: [],
  customer: "",
  problem: "",
  fears: "",
  promise: "",
  differentiators: [],
  packages: [],
  pricingNote: "",
  offer: null,
  noOffer: false,
  campaignType: "",
  channels: [],
  faq: [],
  approvals: {},
  guard: { block: [], warn: [] },
  marketResearch: "",
  researchSources: [],
  researchedAt: "",
  requirements: [],
  nextSteps: [],
  ready: false,
  approvedAt: "",
  runId: "",
};

// ---------- parsing helpers ----------
export function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : typeof v === "number" ? String(v).slice(0, max) : "";
}
function num(v: unknown, min: number, max: number): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "string" ? Number(v.replace(/[^0-9.]/g, "")) : Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : null;
}
function list(v: unknown, max: number, len: number): string[] {
  return (Array.isArray(v) ? v : []).map((x) => str(x, len)).filter(Boolean).slice(0, max);
}
function oneOf<T extends string>(v: unknown, opts: readonly T[]): T | "" {
  return typeof v === "string" && (opts as readonly string[]).includes(v) ? (v as T) : "";
}
function isoDate(v: unknown): string {
  const s = String(v ?? "");
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : "";
}
export function safeHttpUrl(v: unknown): string {
  const s = str(v, 500);
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : "";
  } catch {
    return "";
  }
}
function sources(v: unknown, max = 8): PlanSource[] {
  const out: PlanSource[] = [];
  for (const x of Array.isArray(v) ? v : []) {
    const r = (x ?? {}) as Record<string, unknown>;
    const url = safeHttpUrl(r.url);
    if (url && !out.some((o) => o.url === url)) out.push({ title: str(r.title, 120) || url, url });
    if (out.length >= max) break;
  }
  return out;
}
function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

const US_STATES = new Set(
  "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC PR".split(" ")
);

export function parseProfile(raw: unknown): Profile {
  const p = obj(raw);
  const state = str(p.state, 2).toUpperCase();
  return {
    businessName: str(p.businessName, 80),
    city: str(p.city, 80),
    state: US_STATES.has(state) ? state : "",
    radiusMiles: num(p.radiusMiles, 1, 150),
    languages: oneOf(p.languages, ["es", "en", "both"] as const),
    yearsExperience: num(p.yearsExperience, 0, 70),
    mainService: str(p.mainService, 120),
    exampleJob: str(p.exampleJob, 300),
    typicalCustomer: str(p.typicalCustomer, 240),
    howGetsClients: str(p.howGetsClients, 240),
    currentPrice: str(p.currentPrice, 200),
    costs: str(p.costs, 240),
    differentiators: str(p.differentiators, 400),
    licenseStatus: oneOf(p.licenseStatus, ["has", "no", "not_needed"] as const),
    licenseNote: str(p.licenseNote, 200),
    insured: oneOf(p.insured, ["yes", "no"] as const),
    workHistory: str(p.workHistory, 400),
    askedFor: str(p.askedFor, 300),
    tools: str(p.tools, 300),
    hasVehicle: oneOf(p.hasVehicle, ["yes", "no"] as const),
    hoursPerWeek: num(p.hoursPerWeek, 1, 100),
    startBudgetUsd: num(p.startBudgetUsd, 0, 1_000_000),
    notWant: str(p.notWant, 240),
    goal: oneOf(p.goal, ["extra", "fulltime"] as const),
    toolsReady: oneOf(p.toolsReady, ["yes", "no"] as const),
  };
}

export function parseMarket(raw: unknown): Market {
  const m = obj(raw);
  const pr = obj(m.prices);
  const prices =
    str(pr.low, 40) || str(pr.mid, 40) || str(pr.high, 40)
      ? { low: str(pr.low, 40), mid: str(pr.mid, 40), high: str(pr.high, 40), includes: str(pr.includes, 300), note: str(pr.note, 300) }
      : null;
  return {
    prices,
    competitors: (Array.isArray(m.competitors) ? m.competitors : [])
      .map((x) => {
        const c = obj(x);
        return {
          name: str(c.name, 80),
          url: safeHttpUrl(c.url),
          offer: str(c.offer, 200),
          price: str(c.price, 80),
          guarantee: str(c.guarantee, 120),
          languages: str(c.languages, 40),
        };
      })
      .filter((c) => c.name)
      .slice(0, 5),
    gaps: list(m.gaps, 5, 200),
    requirements: (Array.isArray(m.requirements) ? m.requirements : [])
      .map((x) => {
        const r = obj(x);
        return {
          item: str(r.item, 160),
          applies: (oneOf(r.applies, ["yes", "no", "check"] as const) || "check") as Requirement["applies"],
          link: safeHttpUrl(r.link),
          note: str(r.note, 300),
        };
      })
      .filter((r) => r.item)
      .slice(0, 6),
    faq: parseFaq(m.faq),
    sources: sources(m.sources, 12),
    researchedAt: isoDate(m.researchedAt),
    incomplete: list(m.incomplete, 5, 40),
  };
}

function parseFaq(v: unknown): Faq[] {
  return (Array.isArray(v) ? v : [])
    .map((x) => {
      const f = obj(x);
      return { q: str(f.q, 160), a: str(f.a, 400) };
    })
    .filter((f) => f.q && f.a)
    .slice(0, 8);
}

export function parseIdeas(v: unknown): Idea[] {
  return (Array.isArray(v) ? v : [])
    .map((x) => {
      const i = obj(x);
      return {
        title: str(i.title, 100),
        why: str(i.why, 300),
        typicalPrice: str(i.typicalPrice, 120),
        startCost: str(i.startCost, 120),
        license: str(i.license, 160),
        demand: str(i.demand, 300),
        pros: str(i.pros, 240),
        cons: str(i.cons, 240),
        score: num(i.score, 0, 25) ?? 0,
        sources: sources(i.sources, 4),
      };
    })
    .filter((i) => i.title)
    .slice(0, 5);
}

export function parsePlan(raw: unknown): BusinessPlan {
  const o = obj(raw);
  const offer = obj(o.offer);
  const offerLabel = str(offer.label, 80);
  const legacyReady = o.ready === true;
  const stage = (oneOf(o.stage, STAGES) || (legacyReady ? "approved" : "interview")) as PlanStage;
  const g = obj(o.guard);
  const ap = obj(o.approvals);
  const approvals: Partial<Record<ApprovalBlock, boolean>> = {};
  for (const b of APPROVAL_BLOCKS) if (ap[b] === true) approvals[b] = true;
  const chosen = num(o.chosenIdea, 0, 4);
  return {
    mode: o.mode === "existing" || o.mode === "new" ? o.mode : "",
    stage,
    profile: parseProfile(o.profile),
    market: parseMarket(o.market),
    ideas: parseIdeas(o.ideas),
    chosenIdea: chosen,
    service: str(o.service, 120),
    serviceIncludes: str(o.serviceIncludes, 400),
    serviceExcludes: str(o.serviceExcludes, 300),
    steps: list(o.steps, 5, 160),
    customer: str(o.customer, 240),
    problem: str(o.problem, 240),
    fears: str(o.fears, 240),
    promise: str(o.promise, 200),
    differentiators: list(o.differentiators, 5, 140),
    packages: (Array.isArray(o.packages) ? o.packages : [])
      .map((x) => {
        const p = obj(x);
        return { name: str(p.name, 80), price: str(p.price, 40), includes: str(p.includes, 240), note: str(p.note, 140) };
      })
      .filter((p) => p.name)
      .slice(0, 4),
    pricingNote: str(o.pricingNote, 500),
    offer: offerLabel ? { label: offerLabel, detail: str(offer.detail, 200), endsAt: isoDate(offer.endsAt) } : null,
    noOffer: o.noOffer === true,
    campaignType: str(o.campaignType, 200),
    channels: (Array.isArray(o.channels) ? o.channels : [])
      .map((x) => {
        const c = obj(x);
        return { channel: str(c.channel, 80), why: str(c.why, 200) };
      })
      .filter((c) => c.channel)
      .slice(0, 4),
    faq: parseFaq(o.faq),
    approvals,
    guard: { block: list(g.block, 8, 240), warn: list(g.warn, 8, 240) },
    marketResearch: str(o.marketResearch, 600),
    researchSources: sources(o.researchSources, 6),
    researchedAt: isoDate(o.researchedAt),
    requirements: list(o.requirements, 5, 200),
    nextSteps: list(o.nextSteps, 5, 160),
    ready: legacyReady || stage === "approved",
    approvedAt: isoDate(o.approvedAt),
    runId: str(o.runId, 64),
  };
}

// ---------- what the interviewer still needs, in order ----------
export function missingProfile(plan: BusinessPlan): string[] {
  const p = plan.profile;
  const out: string[] = [];
  const need = (cond: boolean, key: string) => {
    if (cond) out.push(key);
  };
  if (plan.stage === "interview" && plan.mode !== "new") {
    need(!p.mainService, "mainService");
    need(!p.exampleJob, "exampleJob (a recent real job)");
    need(!p.city || !p.state, "city and state");
    need(p.yearsExperience === null, "yearsExperience");
    need(!p.typicalCustomer, "typicalCustomer");
    need(!p.currentPrice, "currentPrice (what they charge today)");
    need(!p.costs, "costs (materials and hours per job)");
    need(!p.differentiators, "differentiators (what makes them different)");
    need(!p.howGetsClients, "howGetsClients (how they get customers today)");
    need(!p.languages, "languages (es, en or both)");
    need(!p.licenseStatus, "licenseStatus (has / no / not_needed)");
    need(!p.insured, "insured (yes / no)");
    need(!p.businessName, "businessName");
  } else if (plan.stage === "interview") {
    need(!p.city || !p.state, "city and state");
    need(!p.workHistory, "workHistory (jobs they have had)");
    need(!p.askedFor, "askedFor (what people ask them to help with)");
    need(!p.tools, "tools (tools and equipment they already have)");
    need(!p.hasVehicle, "hasVehicle (yes / no)");
    need(p.hoursPerWeek === null, "hoursPerWeek");
    need(p.startBudgetUsd === null, "startBudgetUsd (money available to start)");
    need(!p.licenseStatus, "licenseStatus (any license or certification: has / no)");
    need(!p.languages, "languages (es, en or both)");
    need(!p.notWant, "notWant (work they don't want to do)");
    need(!p.goal, "goal (extra income or full time)");
  } else if (plan.stage === "ready_check") {
    const idea = plan.chosenIdea !== null ? plan.ideas[plan.chosenIdea] : undefined;
    const needsLicense = idea ? !/^no\b/i.test(idea.license.trim()) && idea.license.trim() !== "" : false;
    need(needsLicense && p.licenseStatus !== "has", "licenseStatus for the chosen idea (has / no)");
    need(!p.insured, "insured (yes / no)");
    need(!p.toolsReady, "toolsReady (has the tools for the chosen idea: yes / no)");
    need(!p.costs, "costs (materials and hours per job, an estimate is fine)");
    need(!p.businessName, "businessName (last)");
  }
  return out;
}

// ---------- approvals ----------
export function blockHasContent(p: BusinessPlan, b: ApprovalBlock): boolean {
  switch (b) {
    case "service":
      return Boolean(p.service && p.customer);
    case "pitch":
      return Boolean(p.promise && p.differentiators.length);
    case "packages":
      return p.packages.length > 0;
    case "offer":
      return Boolean(p.offer) || p.noOffer;
    case "campaign":
      return Boolean(p.campaignType);
    case "faq":
      return p.faq.length > 0;
  }
}

export function allApproved(p: BusinessPlan): boolean {
  return APPROVAL_BLOCKS.every((b) => p.approvals[b] === true);
}

export function planProgress(p: BusinessPlan): number {
  const order: PlanStage[] =
    p.mode === "new"
      ? ["interview", "ideas_research", "choose", "ready_check", "research", "proposal", "approved"]
      : ["interview", "research", "proposal", "approved"];
  const i = Math.max(0, order.indexOf(p.stage));
  if (p.stage === "proposal") {
    const done = APPROVAL_BLOCKS.filter((b) => p.approvals[b]).length;
    return Math.round(((i + done / APPROVAL_BLOCKS.length) / (order.length - 1)) * 100);
  }
  return Math.round((i / (order.length - 1)) * 100);
}

// Deterministic honesty checks (the AI Guardian adds to these).
const BANNED_CLAIMS = /\b(guarantee[ds]?|garantizad[oa]s?|#\s?1|n[uú]mero\s?1|the best|el mejor|los mejores|top[- ]rated|5[- ]star|5 estrellas|\d+\+?\s*(clientes|customers|reviews|reseñas))\b/i;

// final=false while it is still a proposal: a suggested offer has no date yet.
export function codeChecks(p: BusinessPlan, today: string, final = true): { block: string[]; warn: string[] } {
  const block: string[] = [];
  const warn: string[] = [];
  const texts = [p.promise, ...p.differentiators, ...p.packages.map((x) => `${x.name} ${x.includes}`), p.offer?.label ?? "", p.offer?.detail ?? ""];
  for (const t of texts) if (t && BANNED_CLAIMS.test(t)) block.push(`claim: "${t.slice(0, 80)}" uses a claim that needs proof`);
  if (final && p.offer && !p.offer.endsAt) block.push("offer: the offer needs a real end date");
  if (final && p.offer && p.offer.endsAt && p.offer.endsAt < today) block.push("offer: the end date already passed");
  const licenseNeeded = p.market.requirements.some((r) => r.applies === "yes" && /licen/i.test(r.item));
  if (licenseNeeded && p.profile.licenseStatus === "no") block.push("license: this trade needs a state license the owner doesn't have");
  if (/\b(credit repair|reparaci[oó]n de cr[eé]dito|notari|immigration|inmigraci[oó]n|migratori|loan|pr[eé]stamo)/i.test(`${p.service} ${p.profile.mainService}`))
    block.push("restricted: this kind of service needs a manual review by Sevrii before publishing");
  return { block, warn };
}
