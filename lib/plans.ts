// Sevrii plans. Pure data, shared by server and UI.
// Free → Starter. Starter is paid every 3 months ($105), 6 months ($195) or
// a year ($349), less with a discount code: same features, only the period
// changes. Pro and Team stay
// here for the code that checks them, but they aren't shown or sold.
// - Free: the Brain and the page as a draft.
// - Starter (the paid plan): the page published, Payments (payment links,
//   5 % per payment), Affiliates (others sell the service for a commission)
//   and Capital (credit, coming soon).
// - Pro and Team add Marketing (strategy, campaigns, the agent that launches
//   ads). They depend on features still being built, so they can't be bought
//   yet: people join their waitlist instead. We never sell what doesn't exist.

export type PlanId = "free" | "starter" | "pro" | "team";
export const PLAN_ORDER: PlanId[] = ["free", "starter", "pro", "team"];

export type PlanLimits = {
  projects: number;
  canPublish: boolean; // publish the Store page
  marketing: boolean; // marketing brain: strategy and ready-to-launch campaigns
  autoMarketing: boolean; // agent launches and optimizes ads
  payments: boolean; // charge customers with Stripe (payment links)
  affiliates: boolean; // other people sell the service and earn a commission
  aiPerDay: number; // AI chat messages per account per day
  aiPerMonth: number; // AI chat messages per account per month
  researchPerMonth: number; // Brain research runs per month (each run searches the web)
  aiBudgetUsd: number; // hard stop: real AI cost per account per month
};

export type PlanDef = {
  id: PlanId;
  monthly: number; // USD per month, billed monthly
  yearlyPerMonth: number | null; // USD per month, billed yearly
  available: boolean; // can be bought today
  limits: PlanLimits;
};

export const PLANS: Record<PlanId, PlanDef> = {
  free: {
    id: "free",
    monthly: 0,
    yearlyPerMonth: null,
    available: true,
    limits: { projects: 1, canPublish: false, marketing: false, autoMarketing: false, payments: false, affiliates: false, aiPerDay: 15, aiPerMonth: 150, researchPerMonth: 2, aiBudgetUsd: 3 },
  },
  starter: {
    id: "starter",
    monthly: 29, // the lowest it comes to per month (paid yearly); see STARTER_PRICES
    yearlyPerMonth: 29,
    available: true,
    limits: { projects: 1, canPublish: true, marketing: false, autoMarketing: false, payments: true, affiliates: true, aiPerDay: 60, aiPerMonth: 800, researchPerMonth: 10, aiBudgetUsd: 12 },
  },
  pro: {
    id: "pro",
    monthly: 79,
    yearlyPerMonth: 66,
    available: false,
    limits: { projects: 3, canPublish: true, marketing: true, autoMarketing: true, payments: true, affiliates: true, aiPerDay: 120, aiPerMonth: 2000, researchPerMonth: 25, aiBudgetUsd: 30 },
  },
  team: {
    id: "team",
    monthly: 149,
    yearlyPerMonth: 124, // 17% off, like the others: $1,488 a year
    available: false,
    limits: { projects: 10, canPublish: true, marketing: true, autoMarketing: true, payments: true, affiliates: true, aiPerDay: 240, aiPerMonth: 5000, researchPerMonth: 60, aiBudgetUsd: 60 },
  },
};

// How Starter is paid. Same plan, same features: only the billing period
// changes. There's no monthly plan. Prices are what people see and what Stripe
// charges; a discount code (set by the founder) lowers them to CODE_PRICES.
export type Billing = "quarter" | "semester" | "year";
export const BILLINGS: Billing[] = ["quarter", "semester", "year"];
export type StarterPrice = { months: number; total: number; perMonth: number };
export const STARTER_PRICES: Record<Billing, StarterPrice> = {
  quarter: { months: 3, total: 105, perMonth: 35 },
  semester: { months: 6, total: 195, perMonth: 32.5 },
  year: { months: 12, total: 349, perMonth: 29 },
};
export const CODE_PRICES: Record<Billing, StarterPrice> = {
  quarter: { months: 3, total: 89, perMonth: 29.67 },
  semester: { months: 6, total: 165, perMonth: 27.5 },
  year: { months: 12, total: 297, perMonth: 24.75 },
};
// Against paying $39 a month.
export const SAVINGS: Record<Billing, { es: string; en: string }> = {
  quarter: { es: "Ahorras 10 %", en: "Save 10%" },
  semester: { es: "1 mes gratis", en: "1 month free" },
  year: { es: "3 meses gratis", en: "3 months free" },
};
export function priceFor(b: Billing, coded = false): StarterPrice {
  return (coded ? CODE_PRICES : STARTER_PRICES)[b];
}
export function perMonth(b: Billing, coded = false): number {
  return priceFor(b, coded).perMonth;
}
// "$24.75" style, without trailing zeros on whole amounts.
export function usd(n: number): string {
  return `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
}
export function readBilling(v: string | null | undefined): Billing | null {
  // "month" (the old monthly link) now opens the shortest period.
  return v === "quarter" || v === "semester" || v === "year" ? v : v === "month" ? "quarter" : null;
}
// A discount code as typed: letters, numbers, - and _ (2 to 32), uppercased.
export function cleanCode(v: string | null | undefined): string {
  const c = (v ?? "").trim().toUpperCase();
  return /^[A-Z0-9_-]{2,32}$/.test(c) ? c : "";
}

export type Feature = "publish" | "marketing" | "projects" | "autoMarketing" | "payments" | "affiliates";

// The cheapest plan that unlocks a feature.
export function planFor(feature: Feature, projectsNeeded = 1): PlanId {
  for (const id of PLAN_ORDER) {
    const l = PLANS[id].limits;
    if (feature === "publish" && l.canPublish) return id;
    if (feature === "marketing" && l.marketing) return id;
    if (feature === "autoMarketing" && l.autoMarketing) return id;
    if (feature === "payments" && l.payments) return id;
    if (feature === "affiliates" && l.affiliates) return id;
    if (feature === "projects" && l.projects >= projectsNeeded) return id;
  }
  return "team";
}

export function isAtLeast(current: PlanId, target: PlanId): boolean {
  return PLAN_ORDER.indexOf(current) >= PLAN_ORDER.indexOf(target);
}

// What the account sees (for the UI).
export type ClientPlan = {
  id: PlanId;
  status: "active" | "trialing" | "past_due" | "canceled" | "none";
  renewsAt: string | null;
  cancelAtPeriodEnd: boolean;
  billingReady: boolean; // Stripe keys are set up
  yearlyReady: boolean; // the yearly Starter price exists
  waitlist: PlanId[];
  admin: boolean;
};
