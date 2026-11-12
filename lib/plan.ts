import { cleanAnswers, type CardAnswers } from "./cards";
import { parseTask, type AgentTask } from "./serviceAgentConfig";
// The "expediente" of one project: everything the Brain learns and decides
// about the one service it sells. Store and Marketing only read it. Pure data
// + validation, shared by the agents (server) and the UI (client).

// ref: a market reference, not the owner's own price (until they confirm one).
export type PlanPackage = { name: string; price: string; includes: string; note: string; ref: boolean };
export type PlanChannel = { channel: string; why: string };
export type PlanSource = { title: string; url: string; description?: string };

// Where the project is. The code moves between stages, never the AI.
//  A (already offers): interview → research → proposal → approved
//  B (starting out):   interview → ideas_research → choose → ready_check → research → proposal → approved
export type PlanStage = "interview" | "ideas_research" | "choose" | "ready_check" | "research" | "proposal" | "approved";
export const STAGES: PlanStage[] = ["interview", "ideas_research", "choose", "ready_check", "research", "proposal", "approved"];

export type Profile = {
  businessName: string;
  ownerName: string; // the person's first name, when they said it ("me llamo Carlos")
  city: string;
  zip: string; // 5-digit US ZIP, for local services
  state: string; // 2-letter US state
  // Sevrii works in any country: ISO 3166 two-letter code ("US", "ES", "CO", "MX")
  // and, outside the US, the state, province or region as they said it.
  country: string;
  region: string;
  radiusMiles: number | null;
  // In person in an area (cleaning, moving) or remote/online (video editing, design).
  serviceMode: "local" | "remote" | "";
  remoteScope: "us" | "state" | "world" | ""; // remote only: the whole US, only their own state, or other countries too
  languages: "es" | "en" | "both" | "";
  yearsExperience: number | null; // in the trade (may include years working for others)
  yearsOwnBusiness: number | null; // running their own business: what the page may call "years in business"
  // A
  mainService: string;
  exampleJob: string;
  typicalCustomer: string;
  howGetsClients: string;
  // A ("más clientes"): the work they want MORE of (what they do best or what
  // pays best), in their words; the plan is built around it. And the part of
  // town they work in ("Laureles"), when they said it.
  focus: string;
  area: string;
  // They were asked their price and don't have one to give ("depende", "no sé").
  noPrice: boolean;
  currentPrice: string;
  costs: string;
  differentiators: string;
  // both
  licenseStatus: "has" | "no" | "not_needed" | "";
  licenseNote: string;
  insured: "yes" | "no" | "";
  // Where the work happens (the service model the owner chose). Never changed
  // without their OK: a permit question is asked, not solved by rewriting it.
  workLocation: "own_place" | "client_place" | "online" | "both" | "";
  // A discount or offer only exists if the owner asked for one, in their words.
  offerWanted: string;
  // B
  // What they want: something tied to what they already know ("known"),
  // something new they can learn ("new"), or either ("open").
  direction: "known" | "new" | "open" | "";
  // Where they want to work: from home/online, out (in person), or either.
  workPlace: "home" | "out" | "any" | "";
  // They asked for ideas before the interview ended: research with what we have.
  ideasNow: boolean;
  // A and B: the Brain decided it knows enough to research (it decides, not a
  // fixed list of questions); set when the research couldn't start yet.
  researchReady: boolean;
  workHistory: string;
  askedFor: string;
  tools: string;
  hasVehicle: "yes" | "no" | "";
  hoursPerWeek: number | null;
  startBudgetUsd: number | null;
  // What one job (or one client a month) takes, exactly as the owner said it:
  // the prices are built on these, so they are never guessed.
  costHoursPerJob: number | null;
  costMaterialsUsd: number | null;
  // What they enjoy doing, and what they hate or NEVER want to do again. The
  // second one (notWant) is a hard filter: it never comes back as an idea, an
  // example or a question; it only excludes.
  likes: string;
  notWant: string;
  goal: "extra" | "fulltime" | "";
  toolsReady: "yes" | "no" | "";
  // C: an AI agent that delivers the service by itself. It is a product of
  // its own (like a course or a physical product): it doesn't have to be about
  // what the creator knows. The Brain proposes ideas from the creator's interests.
  agentInterest: string; // topics, problems or markets they'd like it to solve ("open" is fine)
  agentTask: string; // what the agent does for each customer, start to finish
  agentKnowledge: string; // what the owner knows and will teach it (materials, method)
  agentLimits: string; // what it must never do, and when the owner steps in
  agentEdge: string; // what they know or do that a free AI chat doesn't
  // From the cards: how much they want to earn (B) and their goal (A).
  incomeGoal: string;
  ownerGoal: string;
};

// C: the agent the strategy proposes (built later in Store).
export type AgentEdge = { title: string; text: string };
export type PlanAgent = {
  name: string;
  role: string;
  steps: string[];
  limits: string[];
  greeting: string;
  creator: string; // who made it, with the credential that backs it ("Ana · 6 años en recursos humanos")
  edge: AgentEdge[]; // why pay for it instead of a free AI chat
  freeAlt: string; // what a free general AI already does, said honestly
  score: number; // 1-5: how strong the reason to pay is (0 = not rated)
  task: AgentTask; // what it DOES end to end (see lib/serviceAgentConfig.ts)
};

export type PriceRange = { low: string; mid: string; high: string; includes: string; note: string };
// A price someone really publishes (a named business or brand), with its page.
export type PriceExample = { who: string; what: string; price: string; url: string };
// A fact found on the web while talking, quoted with its source.
export type Insight = { fact: string; source: string; url: string };
export type Competitor = { name: string; url: string; offer: string; price: string; guarantee: string; languages: string };
export type Requirement = { item: string; applies: "yes" | "no" | "check"; link: string; note: string };
export type Faq = { q: string; a: string };

export type Market = {
  prices: PriceRange | null;
  examples: PriceExample[];
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
  how: string; // C: how the agent does it with each customer, step by step
  pros: string;
  cons: string;
  score: number; // 0-25
  // What it pays per hour of work in their area (estimated from the research):
  // the ideas are shown best paid first.
  hourlyUsd: number | null;
  // The proposal card: what it is, for whom, digital or in person, what they
  // need to start, the first concrete steps, and which "no sé" answers it uses.
  what: string;
  forWhom: string;
  delivery: "digital" | "fisico" | "ambos" | "";
  needs: string;
  steps: string[];
  usesUnknown: string[];
  sources: PlanSource[];
};

// The Brain designs the offer only. The campaign type and the video/photos it
// still suggests (campaignType, channels, videoScript, photoIdeas) are decided in Marketing.
export type ApprovalBlock = "service" | "pitch" | "packages" | "offer" | "faq";
export const APPROVAL_BLOCKS: ApprovalBlock[] = ["service", "pitch", "packages", "offer", "faq"];

export type PlanGrowth = { diagnosis: string; idealClient: string; priceVsMarket: string; actions: string[] };
export const EMPTY_GROWTH: PlanGrowth = { diagnosis: "", idealClient: "", priceVsMarket: "", actions: [] };

export type BusinessPlan = {
  mode: "existing" | "new" | "agent" | "";
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
  // Concrete first moves for the owner: what to do first, what to have ready,
  // how to get the first client.
  firstSteps: string[];
  customer: string;
  problem: string;
  fears: string;
  promise: string;
  differentiators: string[];
  packages: PlanPackage[];
  pricingNote: string;
  // endsAt YYYY-MM-DD, real. forNewClients: a welcome offer for first-time
  // customers (e.g. "15% off your first cleaning") — honest without an end date.
  offer: { label: string; detail: string; endsAt: string; forNewClients: boolean } | null;
  noOffer: boolean;
  campaignType: string;
  channels: PlanChannel[];
  // A ("más clientes"): why more clients don't come yet, who to sell to first,
  // their price against the market (never changed without them) and three
  // things to do this week. B: the actions to get the first client.
  growth: PlanGrowth;
  // Facts found on the web during the conversation (each with its source): the
  // only figures the interviewer may quote before the full research.
  insights: Insight[];
  insightRuns: number; // web lookups done during the interview (at most 2)
  faq: Faq[];
  agent: PlanAgent | null; // C only
  approvals: Partial<Record<ApprovalBlock, boolean>>;
  guard: { block: string[]; warn: string[] };
  // B: ideas the person turned down, and what they said they'd prefer.
  rejectedIdeas: string[];
  ideaPrefs: string;
  // C: an idea the person brought, evaluated with the same research before going on.
  ownIdea: string;
  // A and B: the interview cards, as answered (see lib/cards.ts), the language
  // the flow runs in (the page's fixed labels follow it), and why each service
  // of the menu fits them (Brain only: never reaches the page).
  cards: CardAnswers;
  flowLang: "es" | "en" | "";
  serviceWhy: string;
  ideaRounds: number;
  // How the owner shows up on the page: a video script and photos to take.
  videoScript: string;
  photoIdeas: string[];
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
  ownerName: "",
  city: "",
  zip: "",
  state: "",
  country: "",
  region: "",
  radiusMiles: null,
  serviceMode: "",
  remoteScope: "",
  languages: "",
  yearsExperience: null,
  yearsOwnBusiness: null,
  mainService: "",
  exampleJob: "",
  typicalCustomer: "",
  howGetsClients: "",
  focus: "",
  area: "",
  noPrice: false,
  currentPrice: "",
  costs: "",
  differentiators: "",
  licenseStatus: "",
  licenseNote: "",
  insured: "",
  workLocation: "",
  offerWanted: "",
  direction: "",
  workPlace: "",
  ideasNow: false,
  researchReady: false,
  workHistory: "",
  askedFor: "",
  tools: "",
  hasVehicle: "",
  hoursPerWeek: null,
  startBudgetUsd: null,
  costHoursPerJob: null,
  costMaterialsUsd: null,
  likes: "",
  notWant: "",
  goal: "",
  toolsReady: "",
  agentInterest: "",
  agentTask: "",
  agentKnowledge: "",
  agentLimits: "",
  agentEdge: "",
  incomeGoal: "",
  ownerGoal: "",
};

export const EMPTY_MARKET: Market = { prices: null, examples: [], competitors: [], gaps: [], requirements: [], faq: [], sources: [], researchedAt: "", incomplete: [] };

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
  firstSteps: [],
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
  growth: EMPTY_GROWTH,
  insights: [],
  insightRuns: 0,
  faq: [],
  agent: null,
  approvals: {},
  guard: { block: [], warn: [] },
  rejectedIdeas: [],
  ideaPrefs: "",
  ownIdea: "",
  cards: {},
  flowLang: "",
  serviceWhy: "",
  ideaRounds: 0,
  videoScript: "",
  photoIdeas: [],
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
  if (typeof v === "number") return String(v).slice(0, max);
  if (typeof v !== "string") return "";
  // "$$8" (a "$" added twice) is always "$8".
  const s = v.trim().replace(/\s+/g, " ").replace(/\$\s*\$(?=\s?\d)/g, "$");
  // Prose too long for its field is cut at a word, with "…", never mid-word.
  // (A sentence stored by the old hard cut — exactly max long, ending in a
  // letter — gets the same treatment.) Text without spaces (ids, links) is
  // cut as before.
  const cutBefore = s.length > max || (s.length === max && /\s/.test(s) && /[\p{L}\d]$/u.test(s));
  if (!cutBefore) return s;
  if (!/\s/.test(s)) return s.slice(0, max);
  const head = s.slice(0, max - 1);
  const space = head.lastIndexOf(" ");
  const base = space > max * 0.5 ? head.slice(0, space) : head;
  return `${base.replace(/[\s,;:.\-–—]+$/u, "")}…`;
}
function num(v: unknown, min: number, max: number): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "string" ? Number(v.replace(/[^0-9.]/g, "")) : Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : null;
}
function dec(v: unknown, min: number, max: number): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "string" ? Number(v.replace(/[^0-9.]/g, "")) : Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n * 100) / 100 : null;
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
const BROKEN_PAGE = /^\s*(error\b|40[34]\b|not found|page not found|p[aá]gina no encontrada|access denied|forbidden|just a moment|attention required|untitled)/i;
function sources(v: unknown, max = 8): PlanSource[] {
  const out: PlanSource[] = [];
  for (const x of Array.isArray(v) ? v : []) {
    const r = (x ?? {}) as Record<string, unknown>;
    const url = safeHttpUrl(r.url);
    // A page that answered with an error is not a source.
    if (url && BROKEN_PAGE.test(str(r.title, 120))) continue;
    if (url && !out.some((o) => o.url === url)) {
      const description = str(r.description, 300);
      out.push({ title: str(r.title, 120) || url, url, ...(description ? { description } : {}) });
    }
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
  const rawCountry = str(p.country, 2).toUpperCase();
  // A US state and a ZIP only exist in the US (and Puerto Rico): "CO" next to
  // country "CO" is Colombia, never Colorado.
  const abroad = /^[A-Z]{2}$/.test(rawCountry) && rawCountry !== "US" && rawCountry !== "PR";
  const state = abroad ? "" : str(p.state, 2).toUpperCase();
  const country = rawCountry;
  return {
    businessName: str(p.businessName, 80),
    ownerName: str(p.ownerName, 60),
    city: str(p.city, 80),
    zip: !abroad && /^\d{5}$/.test(String(p.zip ?? "").trim()) ? String(p.zip).trim() : "",
    state: US_STATES.has(state) ? state : "",
    // A US state means the US; otherwise the country they said (two letters).
    country: /^[A-Z]{2}$/.test(country) ? country : US_STATES.has(state) ? "US" : "",
    region: str(p.region, 60),
    radiusMiles: num(p.radiusMiles, 1, 150),
    serviceMode: oneOf(p.serviceMode, ["local", "remote"] as const),
    remoteScope: oneOf(p.remoteScope, ["us", "state", "world"] as const),
    languages: oneOf(p.languages, ["es", "en", "both"] as const),
    yearsExperience: num(p.yearsExperience, 0, 70),
    yearsOwnBusiness: num(p.yearsOwnBusiness, 0, 70),
    mainService: str(p.mainService, 200),
    exampleJob: str(p.exampleJob, 600),
    typicalCustomer: str(p.typicalCustomer, 500),
    howGetsClients: str(p.howGetsClients, 500),
    focus: str(p.focus, 300),
    area: str(p.area, 80),
    noPrice: p.noPrice === true,
    currentPrice: str(p.currentPrice, 500),
    costs: str(p.costs, 500),
    differentiators: str(p.differentiators, 800),
    licenseStatus: oneOf(p.licenseStatus, ["has", "no", "not_needed"] as const),
    licenseNote: str(p.licenseNote, 400),
    insured: oneOf(p.insured, ["yes", "no"] as const),
    workLocation: oneOf(p.workLocation, ["own_place", "client_place", "online", "both"] as const),
    offerWanted: str(p.offerWanted, 300),
    direction: oneOf(p.direction, ["known", "new", "open"] as const),
    workPlace: oneOf(p.workPlace, ["home", "out", "any"] as const),
    ideasNow: p.ideasNow === true,
    researchReady: p.researchReady === true,
    workHistory: str(p.workHistory, 800),
    askedFor: str(p.askedFor, 600),
    tools: str(p.tools, 600),
    hasVehicle: oneOf(p.hasVehicle, ["yes", "no"] as const),
    hoursPerWeek: num(p.hoursPerWeek, 1, 100),
    startBudgetUsd: num(p.startBudgetUsd, 0, 1_000_000),
    costHoursPerJob: dec(p.costHoursPerJob, 0.25, 500),
    costMaterialsUsd: num(p.costMaterialsUsd, 0, 1_000_000),
    likes: str(p.likes, 600),
    notWant: str(p.notWant, 600),
    goal: oneOf(p.goal, ["extra", "fulltime"] as const),
    toolsReady: oneOf(p.toolsReady, ["yes", "no"] as const),
    agentInterest: str(p.agentInterest, 800),
    agentTask: str(p.agentTask, 1200),
    agentKnowledge: str(p.agentKnowledge, 1200),
    agentLimits: str(p.agentLimits, 800),
    agentEdge: str(p.agentEdge, 1000),
    incomeGoal: str(p.incomeGoal, 300),
    ownerGoal: str(p.ownerGoal, 300),
  };
}

// What the research writes when it finds nothing ("no encontrado", "no publica", "n/a").
const NOT_FOUND = /^\s*(no\s+(se\s+)?encontr\w+|not\s+found|no\s+publica\w*|not\s+published|sin\s+datos?|no\s+data|n\/?a|desconocid\w+|unknown|-+)\s*\.?\s*$/i;
export function found(v: string): string {
  return NOT_FOUND.test(v) ? "" : v;
}

export function parseMarket(raw: unknown): Market {
  const m = obj(raw);
  const pr = obj(m.prices);
  // "No encontrado" is not a price: an empty range, never a sentence like
  // «en el mercado se cobra no encontrado».
  const [lo, mi, hi] = [found(clip(pr.low, 80)), found(clip(pr.mid, 80)), found(clip(pr.high, 80))];
  const prices = lo || mi || hi ? { low: lo, mid: mi, high: hi, includes: found(clip(pr.includes, 800)), note: clip(pr.note, 1200) } : null;
  return {
    prices,
    examples: (Array.isArray(m.examples) ? m.examples : [])
      .map((x) => {
        const e = obj(x);
        return { who: str(e.who, 80), what: str(e.what, 160), price: found(str(e.price, 80)), url: safeHttpUrl(e.url) };
      })
      .filter((e) => e.who && e.price)
      .slice(0, 6),
    competitors: (Array.isArray(m.competitors) ? m.competitors : [])
      .map((x) => {
        const c = obj(x);
        return {
          name: str(c.name, 80),
          url: safeHttpUrl(c.url),
          offer: str(c.offer, 400),
          price: str(c.price, 160),
          guarantee: str(c.guarantee, 240),
          languages: str(c.languages, 80),
        };
      })
      .filter((c) => c.name)
      .slice(0, 5),
    gaps: list(m.gaps, 5, 400),
    requirements: (Array.isArray(m.requirements) ? m.requirements : [])
      .map((x) => {
        const r = obj(x);
        return {
          item: str(r.item, 300),
          applies: (oneOf(r.applies, ["yes", "no", "check"] as const) || "check") as Requirement["applies"],
          link: safeHttpUrl(r.link),
          note: str(r.note, 700),
        };
      })
      .filter((r) => r.item)
      .slice(0, 10),
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
      return { q: str(f.q, 240), a: str(f.a, 900) };
    })
    .filter((f) => f.q && f.a)
    .slice(0, 8);
}

// Cut long text at a word boundary with an ellipsis instead of mid-word.
function clip(v: unknown, max: number): string {
  const t = str(v, 2000);
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[,;:(\s]+$/, "")}…`;
}

export function parseIdeas(v: unknown): Idea[] {
  return (Array.isArray(v) ? v : [])
    .map((x) => {
      const i = obj(x);
      return {
        title: str(i.title, 140),
        why: clip(i.why, 800),
        typicalPrice: clip(i.typicalPrice, 160),
        startCost: clip(i.startCost, 300),
        license: str(i.license, 400),
        demand: clip(i.demand, 800),
        how: clip(i.how, 800),
        pros: str(i.pros, 600),
        cons: str(i.cons, 600),
        score: num(i.score, 0, 25) ?? 0,
        hourlyUsd: num(i.hourlyUsd, 1, 2000),
        what: str(i.what, 400),
        forWhom: str(i.forWhom, 300),
        delivery: oneOf(i.delivery, ["digital", "fisico", "ambos"] as const),
        needs: str(i.needs, 400),
        steps: list(i.steps, 5, 300),
        usesUnknown: list(i.usesUnknown, 8, 40),
        sources: sources(i.sources, 4),
      };
    })
    .filter((i) => i.title)
    .slice(0, 14);
}

export function parsePlanAgent(raw: unknown): PlanAgent | null {
  const a = obj(raw);
  const name = str(a.name, 60);
  const role = str(a.role, 400);
  if (!name && !role) return null;
  const edge = (Array.isArray(a.edge) ? a.edge : [])
    .map((x) => {
      const e = obj(x);
      return { title: str(e.title, 80), text: str(e.text, 400) };
    })
    .filter((e) => e.title || e.text)
    .slice(0, 4);
  return {
    name,
    role,
    steps: list(a.steps, 8, 400),
    limits: list(a.limits, 8, 400),
    greeting: str(a.greeting, 500),
    creator: str(a.creator, 200),
    edge,
    freeAlt: str(a.freeAlt, 600),
    score: num(a.score, 1, 5) ?? 0,
    task: parseTask(a.task),
  };
}

export function parsePlan(raw: unknown): BusinessPlan {
  const o = obj(raw);
  const offer = obj(o.offer);
  const offerLabel = str(offer.label, 160);
  const legacyReady = o.ready === true;
  const stage = (oneOf(o.stage, STAGES) || (legacyReady ? "approved" : "interview")) as PlanStage;
  const g = obj(o.guard);
  const ap = obj(o.approvals);
  const approvals: Partial<Record<ApprovalBlock, boolean>> = {};
  for (const b of APPROVAL_BLOCKS) if (ap[b] === true) approvals[b] = true;
  const chosen = num(o.chosenIdea, 0, 13);
  return {
    mode: o.mode === "existing" || o.mode === "new" || o.mode === "agent" ? o.mode : "",
    stage,
    profile: parseProfile(o.profile),
    market: parseMarket(o.market),
    ideas: parseIdeas(o.ideas),
    chosenIdea: chosen,
    service: str(o.service, 200),
    serviceIncludes: str(o.serviceIncludes, 800),
    serviceExcludes: str(o.serviceExcludes, 600),
    steps: list(o.steps, 5, 500),
    firstSteps: list(o.firstSteps, 5, 400),
    customer: str(o.customer, 500),
    problem: str(o.problem, 500),
    fears: str(o.fears, 500),
    promise: str(o.promise, 300),
    differentiators: list(o.differentiators, 5, 500),
    packages: (Array.isArray(o.packages) ? o.packages : [])
      .map((x) => {
        const p = obj(x);
        return { name: str(p.name, 100), price: str(p.price, 80), includes: str(p.includes, 600), note: str(p.note, 400), ref: p.ref === true };
      })
      .filter((p) => p.name)
      .slice(0, 4),
    pricingNote: str(o.pricingNote, 1500),
    offer: offerLabel ? { label: offerLabel, detail: str(offer.detail, 500), endsAt: isoDate(offer.endsAt), forNewClients: offer.forNewClients === true } : null,
    noOffer: o.noOffer === true,
    campaignType: str(o.campaignType, 400),
    channels: (Array.isArray(o.channels) ? o.channels : [])
      .map((x) => {
        const c = obj(x);
        return { channel: str(c.channel, 120), why: str(c.why, 400) };
      })
      .filter((c) => c.channel)
      .slice(0, 4),
    growth: parseGrowth(o.growth),
    insights: (Array.isArray(o.insights) ? o.insights : [])
      .map((x) => {
        const i = obj(x);
        return { fact: str(i.fact, 400), source: str(i.source, 80), url: safeHttpUrl(i.url) };
      })
      .filter((i) => i.fact)
      .slice(0, 5),
    insightRuns: Math.max(0, Math.min(2, Math.round(Number(o.insightRuns) || 0))),
    faq: parseFaq(o.faq),
    agent: parsePlanAgent(o.agent),
    approvals,
    guard: { block: list(g.block, 8, 400), warn: list(g.warn, 8, 400) },
    rejectedIdeas: list(o.rejectedIdeas, MAX_REJECTED, 120),
    ideaPrefs: typeof o.ideaPrefs === "string" ? o.ideaPrefs.trim().slice(0, 600) : "",
    ownIdea: typeof o.ownIdea === "string" ? o.ownIdea.trim().slice(0, 400) : "",
    cards: cleanAnswers(o.mode === "new" ? "new" : "existing", o.cards),
    flowLang: o.flowLang === "es" || o.flowLang === "en" ? o.flowLang : "",
    serviceWhy: str(o.serviceWhy, 800),
    ideaRounds: num(o.ideaRounds, 0, 999) ?? 0,
    videoScript: typeof o.videoScript === "string" ? o.videoScript.trim().slice(0, 1200) : "",
    photoIdeas: list(o.photoIdeas, 6, 400),
    marketResearch: str(o.marketResearch, 600),
    researchSources: sources(o.researchSources, 6),
    researchedAt: isoDate(o.researchedAt),
    requirements: list(o.requirements, 5, 320),
    nextSteps: list(o.nextSteps, 5, 320),
    ready: legacyReady || stage === "approved",
    approvedAt: isoDate(o.approvedAt),
    runId: str(o.runId, 64),
  };
}

function parseGrowth(raw: unknown): PlanGrowth {
  const g = obj(raw);
  return { diagnosis: str(g.diagnosis, 600), idealClient: str(g.idealClient, 400), priceVsMarket: str(g.priceVsMarket, 600), actions: list(g.actions, 3, 600) };
}

// ---------- what the interviewer still needs, in order ----------
export function missingProfile(plan: BusinessPlan): string[] {
  const p = plan.profile;
  const out: string[] = [];
  const need = (cond: boolean, key: string) => {
    if (cond) out.push(key);
  };
  if (plan.stage === "interview" && plan.mode === "agent") {
    // Only enough to aim the ideas: the agent doesn't depend on the creator's trade.
    need(!p.agentInterest, "agentInterest (topics, problems or markets they'd like their agent to solve; 'open to any idea' is a valid answer)");
    need(!p.typicalCustomer, "typicalCustomer (who they'd like the agent to help; 'anyone' is a valid answer)");
    need(!p.languages, "languages (the language(s) the agent will talk to customers in: es, en or both)");
  } else if (plan.stage === "interview" && plan.mode === "existing") {
    // A ("más clientes"): a conversation, not a form. Only what the research
    // and the plan can't do without, most important first; the rest is
    // deduced or asked only when it changes the plan.
    // Projects that answered the old cards were already asked what they
    // needed there: the chat never re-opens that interview.
    const legacy = Object.keys(plan.cards ?? {}).length > 0;
    need(!p.mainService, "mainService (the service they offer, in their words)");
    need(p.serviceMode !== "remote" && !p.city, "city (where they work: city and country; or that they work online)");
    // Online with no city: the country still sets the currency, the laws and the market.
    need(p.serviceMode === "remote" && !p.city && !p.country, "country (the country they live and work in: prices, currency and laws depend on it)");
    // What they want MORE of decides who the plan sells to: asked right after
    // the service, unless they already said it.
    need(!p.focus && !legacy, "focus (of everything they do, the work they'd like to get MORE of: what they do best or what pays best. If they offer one single thing, save that)");
    need(!p.howGetsClients, "howGetsClients (how customers find them today: walk-ins, referrals, social media, nothing yet…)");
    // Their price lets the plan compare them with the market (never changed
    // without them). "No sé" or "depende" is a valid answer (noPrice).
    need(!p.currentPrice && !p.noPrice && !legacy, "currentPrice (what they charge today for that work, in their words and currency; if they don't have a fixed price, save noPrice=true)");
  } else if (plan.stage === "interview") {
    // B ("descubre tu servicio"): what they know, where, and what they're after.
    need(!p.workHistory && !p.likes, "workHistory (what they know how to do, or jobs they've had)");
    need(p.serviceMode !== "remote" && p.workPlace !== "home" && !p.city, "city (where they live: city and country; or that they want to work online)");
    need((p.serviceMode === "remote" || p.workPlace === "home") && !p.city && !p.country, "country (the country they live in: prices, currency and laws depend on it)");
    need(!p.goal, "goal (extra income, or to live from it: extra / fulltime)");
  } else if (plan.stage === "ready_check" && plan.mode === "agent") {
    // The reach goes first: picking an idea already asks it (chooseIdeaAction),
    // so the quick answers under the chat match that question.
    need(!p.remoteScope, "remoteScope (customers in the whole US = us, only one state = state, other countries too = world)");
    need(p.remoteScope === "state" && !p.state, "state (the one state whose customers it serves)");
    need(!p.agentTask, "agentTask (the complete task the agent DOES for each customer end to end — result left done, official pages it operates, sensitive data the customer types and when, how it proves it's done: propose it yourself from the chosen idea and ask them to confirm or adjust)");
    need(!p.agentLimits, "agentLimits (what it must never do and when the creator steps in: propose sensible limits for this idea and ask them to confirm)");
    need(!p.businessName, "businessName (last: suggest 2 short brand names for the agent)");
  } else if (plan.stage === "ready_check") {
    // B after picking an idea: only how it's delivered, if it isn't obvious.
    need(!p.serviceMode, "serviceMode (the chosen service: in person in an area = local, or remote/online = remote)");
    // In person needs the area (someone who said "digital" on the cards never gave one).
    need(p.serviceMode === "local" && !p.city, "city (city and country where they would offer the chosen service in person)");
  }
  return out;
}

// A and B: the Brain itself decides when it knows enough (start_research);
// C still follows its own short list.
export function profileComplete(plan: BusinessPlan): boolean {
  if (missingProfile(plan).length) return false;
  return plan.mode === "agent" || plan.stage === "ready_check" || plan.profile.researchReady;
}

// A: the numbers that make a proposal "theirs". Without every one of them
// confirmed on the cards, no price is presented as the owner's own.
export const OWN_NUMBER_CARDS = ["prices", "costs", "hours", "clients", "goal"];
export function ownNumbersConfirmed(plan: BusinessPlan): boolean {
  if (plan.mode !== "existing") return false;
  return OWN_NUMBER_CARDS.every((id) => {
    const a = plan.cards[id];
    return a && !a.u && (a.v.trim() || a.c);
  });
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
    case "faq":
      return p.faq.length > 0;
  }
}

export function allApproved(p: BusinessPlan): boolean {
  return APPROVAL_BLOCKS.every((b) => p.approvals[b] === true);
}

export function planProgress(p: BusinessPlan): number {
  const order: PlanStage[] =
    p.mode === "new" || p.mode === "agent"
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

const PROMISED_RESULT = /\b(vas a aprobar|aprobar[aá]s|aprobaci[oó]n (segura|garantizada)|asegura(mos)? (tu|la) (licencia|aprobaci[oó]n)|obt(endr[aá]s|ienes) (tu|la) licencia (seguro|s[ií] o s[ií])|100\s?% (aprobado|garantizado)|you will pass|guaranteed (pass|approval|license))\b/i;

// final=false while it is still a proposal: a suggested offer has no date yet.
export function codeChecks(p: BusinessPlan, today: string, final = true): { block: string[]; warn: string[] } {
  const block: string[] = [];
  const warn: string[] = [];
  const texts = [p.promise, ...p.differentiators, ...p.packages.map((x) => `${x.name} ${x.includes}`), p.offer?.label ?? "", p.offer?.detail ?? ""];
  for (const t of texts) if (t && BANNED_CLAIMS.test(t)) block.push(`claim: "${t.slice(0, 80)}" uses a claim that needs proof`);
  // Agents guide; they never promise the outcome (passing, approvals, licenses).
  const outcome = [...texts, p.agent?.role ?? "", ...(p.agent?.edge ?? []).map((e) => `${e.title} ${e.text}`), ...p.faq.map((f) => f.a)];
  for (const t of outcome) if (t && PROMISED_RESULT.test(t)) block.push(`promise: "${t.slice(0, 80)}" promises a result; say it guides and accompanies instead`);
  // Languages: only the ones the owner said. Never "bilingual" by default.
  const langTexts = [p.promise, ...p.differentiators, ...p.packages.map((x) => `${x.name} ${x.includes} ${x.note}`), ...p.faq.map((f) => `${f.q} ${f.a}`), p.serviceIncludes, ...p.steps];
  // (Saying competitors only speak English is fine; claiming to serve in it is not.)
  const BOTH = /\b(biling[uü]e|bilingual)\b|(espa[ñn]ol|spanish)\s+(y|e|o|and|or)\s+(en\s+|in\s+)?(ingl[eé]s|english)|(ingl[eé]s|english)\s+(y|e|o|and|or)\s+(en\s+|in\s+)?(espa[ñn]ol|spanish)/i;
  const SAYS_EN = new RegExp(`${BOTH.source}|\\b(atiendo|atendemos|hablo|hablamos|te atiendo|te atendemos|we speak|we serve|i speak|in)\\s+(en\\s+)?(ingl[eé]s|english)\\b`, "i");
  const SAYS_ES = new RegExp(`${BOTH.source}|\\b(we speak|we serve|i speak|se habla|hablamos|in)\\s+(en\\s+)?(espa[ñn]ol|spanish)\\b`, "i");
  const langs = p.profile.languages;
  if (langs === "es") for (const t of langTexts) if (t && SAYS_EN.test(t)) { block.push(`lang: "${t.slice(0, 80)}" says it serves in English but the owner serves only in Spanish`); break; }
  if (langs === "en") for (const t of langTexts) if (t && SAYS_ES.test(t)) { block.push(`lang: "${t.slice(0, 80)}" says Spanish/bilingual but the owner serves only in English`); break; }
  if (final && p.offer && !p.offer.endsAt && !p.offer.forNewClients) block.push("offer: the offer needs a real end date");
  if (final && p.offer && p.offer.endsAt && p.offer.endsAt < today) block.push("offer: the end date already passed");
  if (isRestrictedService(p)) block.push("restricted: Sevrii doesn't publish this kind of service (regulated by law)");
  return { block, warn };
}

// ---------- Services Sevrii doesn't publish ----------
// Notary, immigration paperwork, loans and credit repair are heavily
// regulated (and "notario" fraud hurts Latino families): Sevrii doesn't publish
// them for now. Checked on everything that names the service, including what
// the owner wrote on the card and the idea they chose, so renaming the
// strategy never gets around it.
// ("notaría" with its accent too: "notari" alone let it through.)
export const RESTRICTED_SERVICE = /\b(credit repair|reparaci[oó]n de cr[eé]dito|notar[ií]|notary|immigration|inmigraci[oó]n|migratori|loan|pr[eé]stamo)/i;
export function isRestrictedService(p: Pick<BusinessPlan, "service" | "profile" | "cards" | "ideas" | "chosenIdea" | "ownIdea">): boolean {
  const idea = p.chosenIdea !== null && p.chosenIdea !== undefined ? p.ideas[p.chosenIdea]?.title ?? "" : "";
  const card = p.cards?.service && !p.cards.service.u ? p.cards.service.v : "";
  return RESTRICTED_SERVICE.test([p.service, p.profile.mainService, card, idea, p.ownIdea].join(" "));
}

// ---------- B: "show me other ideas" ----------
// "Dame otras" has no limit of its own (the plan's AI budget still applies).
export const MAX_IDEA_ROUNDS = 999;
// Every rejected idea is remembered (B sees ~10 per round): with a cap of 80
// the oldest ones were forgotten after 8 rounds and could come back.
export const MAX_REJECTED = 400;

// Sends the person back to idea research, remembering what they turned down
// and what they said they'd prefer, so the next ideas are different.
export function requestMoreIdeas(plan: BusinessPlan, feedback: string): BusinessPlan {
  const rejected = [...new Set([...plan.rejectedIdeas, ...plan.ideas.map((i) => i.title), ...(plan.service ? [plan.service] : [])])].slice(-MAX_REJECTED);
  const note = feedback.trim().replace(/\s+/g, " ").slice(0, 300);
  // What the rejected batch says by itself: all in person → lean digital, and so on.
  const kinds = plan.ideas.map((i) => i.delivery).filter(Boolean);
  const lean =
    kinds.length >= 3 && kinds.every((k) => k === "fisico")
      ? "rechazó todas las ideas en persona: da más peso a las digitales"
      : kinds.length >= 3 && kinds.every((k) => k === "digital")
        ? "rechazó todas las ideas digitales: da más peso a las de en persona"
        : "";
  const prefs = [plan.ideaPrefs, note, lean].filter(Boolean).join(" | ").slice(-600);
  return parsePlan({
    ...plan,
    rejectedIdeas: rejected,
    ideaPrefs: prefs,
    ideaRounds: plan.ideaRounds + 1,
    ideas: [],
    chosenIdea: null,
    stage: "ideas_research",
    runId: "",
  });
}

// Requirements shown to the owner: only what's indispensable. For online
// services an insurance that no law requires is never a requirement.
export function shownRequirements(p: BusinessPlan): Requirement[] {
  const remote = p.profile.serviceMode === "remote";
  return p.market.requirements.filter((r) => !(remote && r.applies !== "yes" && /(seguro|insurance|liability|responsabilidad civil)/i.test(`${r.item} ${r.note}`)));
}
