// Sevrii plans. Pure data, shared by server and UI.
// Free → Starter ($29) → Pro ($79) → Team ($149). Each plan includes the one
// below it. Pro and Team depend on features still being built (the Marketing
// agent that launches ads, Payments), so they can't be bought yet: people can
// join their waitlist instead. We never sell what doesn't exist.

export type PlanId = "free" | "starter" | "pro" | "team";
export const PLAN_ORDER: PlanId[] = ["free", "starter", "pro", "team"];

export type PlanLimits = {
  projects: number;
  canPublish: boolean; // publish the Store page
  marketing: boolean; // marketing brain: strategy and ready-to-launch campaigns
  autoMarketing: boolean; // agent launches and optimizes ads
  payments: boolean; // charge customers with Stripe
  aiPerDay: number; // AI chat messages per account per day
  researchPerDay: number; // full Brain research runs per day
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
    limits: { projects: 1, canPublish: false, marketing: false, autoMarketing: false, payments: false, aiPerDay: 60, researchPerDay: 2 },
  },
  starter: {
    id: "starter",
    monthly: 29,
    yearlyPerMonth: 24,
    available: true,
    limits: { projects: 1, canPublish: true, marketing: true, autoMarketing: false, payments: false, aiPerDay: 200, researchPerDay: 3 },
  },
  pro: {
    id: "pro",
    monthly: 79,
    yearlyPerMonth: 66,
    available: false,
    limits: { projects: 3, canPublish: true, marketing: true, autoMarketing: true, payments: true, aiPerDay: 400, researchPerDay: 6 },
  },
  team: {
    id: "team",
    monthly: 149,
    yearlyPerMonth: null,
    available: false,
    limits: { projects: 10, canPublish: true, marketing: true, autoMarketing: true, payments: true, aiPerDay: 800, researchPerDay: 12 },
  },
};

export type Feature = "publish" | "marketing" | "projects" | "autoMarketing" | "payments";

// The cheapest plan that unlocks a feature.
export function planFor(feature: Feature, projectsNeeded = 1): PlanId {
  for (const id of PLAN_ORDER) {
    const l = PLANS[id].limits;
    if (feature === "publish" && l.canPublish) return id;
    if (feature === "marketing" && l.marketing) return id;
    if (feature === "autoMarketing" && l.autoMarketing) return id;
    if (feature === "payments" && l.payments) return id;
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
  waitlist: PlanId[];
  admin: boolean;
};
