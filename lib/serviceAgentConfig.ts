// A service agent: an AI the owner creates that delivers their service by
// itself, in the chat of their page (e.g. a tutor for the Texas electrician
// exam). Customers try it for a few replies, then pay for access. Pure data,
// shared by server and UI.

export type AgentBilling = "once" | "monthly";

export type AgentOffer = {
  id: string;
  title: string; // e.g. "Sesión de práctica"
  detail: string; // what they get, one line
  priceCents: number; // at least $15 (Payments' minimum)
  billing: AgentBilling;
  hours: number; // once: how long the access lasts (monthly: ignored)
  replies: number; // replies included in one access period
};

export type ServiceAgent = {
  enabled: boolean; // live on the page (the page chat becomes the agent)
  name: string; // what the agent is called, e.g. "Tutor Kevin IA"
  role: string; // one line: what it does for the customer
  instructions: string; // how it works, step by step (the owner's method)
  knowledge: string; // what it knows: the owner's notes, rules, materials
  limits: string[]; // what it must never do, and when the owner takes over
  greeting: string; // first message to a customer
  freeReplies: number; // replies a customer gets before paying (0-10)
  offers: AgentOffer[];
  // Welcome offer: % off a new customer's first purchase (0 = none), on all
  // offers or only the one-time / monthly ones (monthly: the first month).
  welcomePercent: number;
  welcomeOn: "all" | "once" | "monthly";
  // Shown on its page: who made it, and why it's worth paying for.
  creator: string; // "Ana · 6 años en recursos humanos"
  edge: { title: string; text: string }[];
};

export const AGENT_MIN_CENTS = 1500;
export const AGENT_MAX_CENTS = 100_000;
export const AGENT_LIMITS = { name: 60, role: 200, instructions: 6000, knowledge: 30000, limit: 240, limits: 12, greeting: 400, offers: 4, offerTitle: 80, offerDetail: 200 };

export const EMPTY_AGENT: ServiceAgent = {
  enabled: false,
  name: "",
  role: "",
  instructions: "",
  knowledge: "",
  limits: [],
  greeting: "",
  freeReplies: 3,
  offers: [],
  welcomePercent: 0,
  welcomeOn: "all",
  creator: "",
  edge: [],
};

const s = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\u0000/g, "").trim().slice(0, max) : "");
const n = (v: unknown, lo: number, hi: number, d: number) => {
  const x = Math.round(Number(v));
  return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d;
};

// "12 meses", "1 año", "7 días", "48 horas" in an offer's text → hours of access.
const MAX_ACCESS_HOURS = 24 * 366;
export function periodHours(text: string): number | null {
  const t = text.toLowerCase();
  const y = /(\d{1,2}|un|una|one|a)\s*(a[ñn]os?|years?)\b/i.exec(t);
  if (y) return Math.min(MAX_ACCESS_HOURS, (/^\d+$/.test(y[1]) ? Number(y[1]) : 1) * 365 * 24);
  const m = /(\d{1,2})\s*(meses|mes|months?)\b/i.exec(t);
  if (m) return Math.min(MAX_ACCESS_HOURS, (Number(m[1]) === 12 ? 365 : Number(m[1]) * 30) * 24);
  const d = /(\d{1,3})\s*(d[ií]as?|days?)\b/i.exec(t);
  if (d) return Math.min(MAX_ACCESS_HOURS, Number(d[1]) * 24);
  const h = /(\d{1,3})\s*(horas?|hours?|hrs?)\b/i.exec(t);
  if (h) return Math.min(MAX_ACCESS_HOURS, Number(h[1]));
  return null;
}

export function parseOffer(raw: unknown, i = 0): AgentOffer | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const title = s(o.title, AGENT_LIMITS.offerTitle);
  const priceCents = n(o.priceCents, 0, AGENT_MAX_CENTS, 0);
  if (!title || priceCents < AGENT_MIN_CENTS) return null;
  const billing: AgentBilling = o.billing === "monthly" ? "monthly" : "once";
  return {
    id: s(o.id, 24) || `o${i + 1}`,
    title,
    detail: s(o.detail, AGENT_LIMITS.offerDetail),
    priceCents,
    billing,
    // One-time access: the hours given, or (when missing or left at the 1-day
    // default) the period the offer's own title or detail names ("12 meses").
    hours: billing === "once" ? (() => {
      const h = n(o.hours, 1, MAX_ACCESS_HOURS, 24);
      if (o.hours !== undefined && h !== 24) return h;
      const named = periodHours(title) ?? periodHours(s(o.detail, AGENT_LIMITS.offerDetail));
      return named && named > h ? named : h;
    })() : 0,
    replies: n(o.replies, 10, 5000, billing === "monthly" ? 600 : 120),
  };
}

export function parseServiceAgent(raw: unknown): ServiceAgent {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const offers: AgentOffer[] = [];
  if (Array.isArray(o.offers)) {
    for (const [i, x] of o.offers.entries()) {
      const p = parseOffer(x, i);
      if (p && !offers.some((y) => y.id === p.id)) offers.push(p);
      if (offers.length >= AGENT_LIMITS.offers) break;
    }
  }
  return {
    enabled: o.enabled === true,
    name: s(o.name, AGENT_LIMITS.name),
    role: s(o.role, AGENT_LIMITS.role),
    instructions: s(o.instructions, AGENT_LIMITS.instructions),
    knowledge: s(o.knowledge, AGENT_LIMITS.knowledge),
    limits: (Array.isArray(o.limits) ? o.limits : []).map((x) => s(x, AGENT_LIMITS.limit)).filter(Boolean).slice(0, AGENT_LIMITS.limits),
    greeting: s(o.greeting, AGENT_LIMITS.greeting),
    freeReplies: n(o.freeReplies, 0, 10, 3),
    offers,
    welcomePercent: n(o.welcomePercent, 0, 50, 0),
    welcomeOn: o.welcomeOn === "once" || o.welcomeOn === "monthly" ? o.welcomeOn : "all",
    creator: s(o.creator, 120),
    edge: (Array.isArray(o.edge) ? o.edge : [])
      .map((x) => {
        const e = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
        return { title: s(e.title, 60), text: s(e.text, 220) };
      })
      .filter((e) => e.title || e.text)
      .slice(0, 4),
  };
}

// The welcome discount for this offer on a first purchase, in percent. It
// never takes the price under the $15 minimum (5% all included).
export function welcomeFor(a: ServiceAgent, o: AgentOffer): number {
  if (!a.welcomePercent || (a.welcomeOn !== "all" && a.welcomeOn !== o.billing)) return 0;
  // Only where the whole % fits: a smaller, odd % ("11% off") reads as a mistake.
  return discounted(o.priceCents, a.welcomePercent) >= AGENT_MIN_CENTS ? a.welcomePercent : 0;
}
export const discounted = (cents: number, pct: number) => Math.round(cents * (1 - pct / 100));

// Is there enough to switch it on?
export function agentMissing(a: ServiceAgent): ("name" | "role" | "instructions")[] {
  const out: ("name" | "role" | "instructions")[] = [];
  if (!a.name) out.push("name");
  if (!a.role) out.push("role");
  if (a.instructions.length < 40) out.push("instructions");
  return out;
}

export function money(cents: number): string {
  const d = cents / 100;
  return `$${Number.isInteger(d) ? d : d.toFixed(2)}`;
}

export function welcomeLabel(a: ServiceAgent, o: AgentOffer, lang: "es" | "en"): string {
  const pct = welcomeFor(a, o);
  if (!pct) return "";
  const price = money(discounted(o.priceCents, pct));
  const es = lang === "es";
  if (o.billing === "monthly") return es ? `${pct}% menos tu primer mes: ${price}` : `${pct}% off your first month: ${price}`;
  return es ? `${pct}% menos en tu primera compra: ${price}` : `${pct}% off your first purchase: ${price}`;
}

export function offerPriceLabel(o: AgentOffer, lang: "es" | "en"): string {
  const es = lang === "es";
  if (o.billing === "monthly") return es ? `${money(o.priceCents)} al mes` : `${money(o.priceCents)} a month`;
  const h = o.hours;
  const d = h / 24;
  const span =
    h % 24 !== 0
      ? es ? `${h} horas` : `${h} hours`
      : d === 1
        ? es ? "1 día" : "1 day"
        : d % 365 === 0 || d === 366
          ? d <= 366 ? (es ? "12 meses" : "12 months") : es ? `${Math.round(d / 365)} años` : `${Math.round(d / 365)} years`
          : d % 30 === 0 && d >= 60
            ? es ? `${d / 30} meses` : `${d / 30} months`
            : es ? `${d} días` : `${d} days`;
  return es ? `${money(o.priceCents)} · acceso por ${span}` : `${money(o.priceCents)} · ${span} of access`;
}
