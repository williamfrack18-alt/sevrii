// "Cerebro": the business plan of one project — what service to sell, to whom,
// how, at what price, with what offer and what kind of campaign. Pure data +
// validation, shared by the agent (server) and the UI (client).

export type PlanPackage = { name: string; price: string; includes: string; note: string };
export type PlanChannel = { channel: string; why: string };

export type BusinessPlan = {
  mode: "existing" | "new" | "";
  service: string; // the one thing this project sells
  customer: string; // who buys it
  problem: string; // the pain it solves
  promise: string; // one-line value proposition
  differentiators: string[];
  packages: PlanPackage[];
  pricingNote: string; // how the prices were set (costs, margin, local range)
  offer: { label: string; detail: string } | null; // a real launch offer, never fake urgency
  campaignType: string; // the recommended kind of campaign, in one line
  channels: PlanChannel[];
  requirements: string[]; // licenses, insurance, permits to check
  nextSteps: string[];
  ready: boolean; // the owner approved the plan
};

export const EMPTY_PLAN: BusinessPlan = {
  mode: "",
  service: "",
  customer: "",
  problem: "",
  promise: "",
  differentiators: [],
  packages: [],
  pricingNote: "",
  offer: null,
  campaignType: "",
  channels: [],
  requirements: [],
  nextSteps: [],
  ready: false,
};

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "";
}
function list(v: unknown, max: number, len: number): string[] {
  return (Array.isArray(v) ? v : []).map((x) => str(x, len)).filter(Boolean).slice(0, max);
}

export function parsePlan(raw: unknown): BusinessPlan {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const offer = (o.offer && typeof o.offer === "object" ? o.offer : null) as Record<string, unknown> | null;
  const offerLabel = offer ? str(offer.label, 80) : "";
  return {
    mode: o.mode === "existing" || o.mode === "new" ? o.mode : "",
    service: str(o.service, 120),
    customer: str(o.customer, 240),
    problem: str(o.problem, 240),
    promise: str(o.promise, 200),
    differentiators: list(o.differentiators, 5, 140),
    packages: (Array.isArray(o.packages) ? o.packages : [])
      .map((x) => {
        const p = (x ?? {}) as Record<string, unknown>;
        return { name: str(p.name, 80), price: str(p.price, 40), includes: str(p.includes, 240), note: str(p.note, 140) };
      })
      .filter((p) => p.name)
      .slice(0, 4),
    pricingNote: str(o.pricingNote, 400),
    offer: offerLabel ? { label: offerLabel, detail: str(offer!.detail, 200) } : null,
    campaignType: str(o.campaignType, 200),
    channels: (Array.isArray(o.channels) ? o.channels : [])
      .map((x) => {
        const c = (x ?? {}) as Record<string, unknown>;
        return { channel: str(c.channel, 80), why: str(c.why, 200) };
      })
      .filter((c) => c.channel)
      .slice(0, 4),
    requirements: list(o.requirements, 5, 200),
    nextSteps: list(o.nextSteps, 5, 160),
    ready: o.ready === true,
  };
}

// What the brain still needs, in the order it should ask.
export function missingForPlan(p: BusinessPlan): string[] {
  const out: string[] = [];
  if (!p.service) out.push("service");
  if (!p.customer) out.push("customer");
  if (!p.problem) out.push("problem");
  if (p.differentiators.length === 0) out.push("differentiators");
  if (p.packages.length === 0 || p.packages.every((x) => !x.price)) out.push("packages_with_prices");
  if (!p.promise) out.push("promise");
  if (!p.campaignType) out.push("campaignType");
  if (!p.ready) out.push("owner_approval");
  return out;
}

export function planProgress(p: BusinessPlan): number {
  const total = 8;
  return Math.round(((total - missingForPlan(p).length) / total) * 100);
}
