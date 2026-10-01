// Simulated "Sevrii AI" logic.
//
// These functions stand in for a real LLM call. They are intentionally
// isolated behind plain functions so that swapping in a real model later
// (OpenAI, Anthropic, etc.) only means changing the implementation here —
// nothing in the UI or database layer needs to change.
//
// Important: this app generates content for real businesses that real users
// will publish. It never fabricates customer reviews, testimonials, or
// performance numbers — those stay empty/zero until the business owner (or
// a real connected data source) provides them.

export const CATEGORIES = [
  "Appliance repair",
  "Home carpentry",
  "Cleaning services",
  "Landscaping",
  "Plumbing",
  "Electrical",
  "HVAC",
  "Handyman",
  "Other",
] as const;

export type Category = (typeof CATEGORIES)[number];

const STARTER_SERVICES: Record<string, { name: string; price: string }[]> = {
  "Appliance repair": [
    { name: "Diagnostic visit", price: "From $45" },
    { name: "Washer / dryer repair", price: "From $95" },
    { name: "Refrigerator repair", price: "From $110" },
  ],
  "Home carpentry": [
    { name: "Custom shelving", price: "Quote on request" },
    { name: "Door & trim repair", price: "From $80" },
    { name: "Furniture assembly", price: "From $60" },
  ],
  "Cleaning services": [
    { name: "Standard home clean", price: "From $90" },
    { name: "Deep clean", price: "From $150" },
    { name: "Move-in / move-out clean", price: "From $180" },
  ],
  Landscaping: [
    { name: "Lawn maintenance", price: "From $50/visit" },
    { name: "Seasonal cleanup", price: "From $120" },
    { name: "Garden design", price: "Quote on request" },
  ],
  Plumbing: [
    { name: "Leak repair", price: "From $85" },
    { name: "Drain cleaning", price: "From $95" },
    { name: "Fixture installation", price: "From $70" },
  ],
  Electrical: [
    { name: "Electrical inspection", price: "From $75" },
    { name: "Outlet & switch repair", price: "From $60" },
    { name: "Panel upgrade", price: "Quote on request" },
  ],
  HVAC: [
    { name: "AC tune-up", price: "From $90" },
    { name: "Heating repair", price: "From $100" },
    { name: "Filter & maintenance plan", price: "From $30/mo" },
  ],
  Handyman: [
    { name: "General repairs", price: "From $55/hr" },
    { name: "Mounting & installs", price: "From $50" },
    { name: "Small home projects", price: "Quote on request" },
  ],
  Other: [
    { name: "Initial consultation", price: "Free" },
    { name: "Standard service", price: "Quote on request" },
  ],
};

export function suggestServices(category: string) {
  return STARTER_SERVICES[category] ?? STARTER_SERVICES.Other;
}

export function generatePitch(opts: {
  name: string;
  category: string;
  description: string;
  city?: string;
}): string {
  const { name, category, description, city } = opts;
  const place = city ? ` in ${city}` : " in your area";
  const trimmedDesc = description.trim().replace(/\.$/, "");
  return `${name} brings dependable ${category.toLowerCase()}${place}. ${trimmedDesc}. Message us and we'll get back to you the same day.`;
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}

export type OnboardingStep =
  | "ask_name"
  | "ask_category"
  | "ask_city"
  | "ask_description"
  | "done";

export function nextOnboardingPrompt(step: OnboardingStep): string {
  switch (step) {
    case "ask_name":
      return "What's the name of your business?";
    case "ask_category":
      return `Got it. What kind of work does it do? (${CATEGORIES.slice(0, -1).join(", ")}, or something else)`;
    case "ask_city":
      return "Where are you based — what city or area do you serve?";
    case "ask_description":
      return "Last one: in a sentence or two, what makes your work worth calling? (what you specialize in, how long you've been doing it, anything customers should know)";
    case "done":
      return "Perfect — building your page now.";
  }
}

export function matchCategory(input: string): string {
  const lower = input.toLowerCase();
  const found = CATEGORIES.find((c) => lower.includes(c.toLowerCase()));
  return found ?? "Other";
}

// Marketing chat: proposes a campaign DRAFT. It never claims the campaign is
// live or reports fabricated results — those stay at zero until a real ad
// account is connected.
export function draftCampaign(opts: { businessName: string; category: string; goal: string }) {
  const { businessName, category, goal } = opts;
  return {
    title: `${goal} — ${businessName}`,
    goal,
    adCopyDraft: `Need ${category.toLowerCase()}? ${businessName} is taking new customers this week. Message us on WhatsApp for a free quote.`,
    suggestedBudget: "Start at $10/day, adjust after the first week",
  };
}

// ============================================================================
// "I want to offer a service, but I'm not sure what" — the discovery path.
// Mirrors the Bifurcación → discovery chat → analysis → ideas → details chat
// → proposal flow from the design prototype, wired to real generated content
// instead of a fixed example (no hardcoded city/business — everything below
// is derived from what the person actually types).
// ============================================================================

export type DiscoveryStep =
  | "ask_location"
  | "ask_background"
  | "ask_license"
  | "ask_capacity"
  | "done";

export function nextDiscoveryPrompt(step: DiscoveryStep): string {
  switch (step) {
    case "ask_location":
      return "Hi! I'm going to ask a few questions to find a service that's a good fit for you — and that people will actually pay for. First: what city and state are you in?";
    case "ask_background":
      return "Got it. Now tell me about you: what have you done for work before, and is there anything people already come to you for help with?";
    case "ask_license":
      return "That's useful. Do you have any licenses or certifications relevant to that kind of work, or is it more general / handyman-level?";
    case "ask_capacity":
      return "Noted. How much time could you realistically give this each week, and do you already have the tools or equipment you'd need?";
    case "done":
      return "Perfect — that's enough for me to work with. Give me a second to put together a few ideas that fit your experience, your area, and your schedule.";
  }
}

export type DiscoveryAnswers = {
  location: string;
  background: string;
  license: string;
  capacity: string;
};

export type Cluster = "construction" | "cleaning" | "landscaping" | "general";

const CLUSTER_KEYWORDS: Record<Exclude<Cluster, "general">, string[]> = {
  construction: [
    "construction",
    "framing",
    "carpentry",
    "carpenter",
    "electrical",
    "electrician",
    "handyman",
    "building",
    "contractor",
    "renovation",
    "remodel",
    "plumbing",
    "plumber",
    "repair",
    "wood",
  ],
  cleaning: ["clean", "cleaning", "housekeep", "maid", "janitor"],
  landscaping: ["lawn", "garden", "landscap", "yard", "tree"],
};

export function detectCluster(text: string): Cluster {
  const lower = text.toLowerCase();
  for (const [cluster, keywords] of Object.entries(CLUSTER_KEYWORDS) as [
    Exclude<Cluster, "general">,
    string[],
  ][]) {
    if (keywords.some((k) => lower.includes(k))) return cluster;
  }
  return "general";
}

function hasLicenseSignal(text: string): boolean {
  const lower = text.toLowerCase();
  if (/no license|not licensed|no certification|none|n\/a/.test(lower)) return false;
  return /licen|certif/.test(lower);
}

function hasOwnToolsSignal(text: string): boolean {
  const lower = text.toLowerCase();
  return /(own|have|got).{0,15}(tool|truck|van|equipment)/.test(lower) || /tools? and a (truck|van)/.test(lower);
}

function hasInformalDemandSignal(text: string): boolean {
  const lower = text.toLowerCase();
  return /(neighbor|friend|family|people).{0,20}(ask|come to me|hire me|call me)/.test(lower) || /already ask/.test(lower);
}

export type Idea = { tag: string; title: string; tagline: string; desc: string; requiresLicense: boolean };

const IDEA_BANK: Record<Cluster, { setA: Idea[]; setB: Idea[] }> = {
  construction: {
    setA: [
      {
        tag: "Higher ticket",
        title: "Custom Home Carpentry",
        tagline: "Custom carpentry, built to last.",
        desc: "Builds directly on hands-on framing and building experience; project-based work usually has better margins than one-off handyman jobs.",
        requiresLicense: false,
      },
      {
        tag: "Recurring service",
        title: "Residential Electrical Maintenance",
        tagline: "Small electrical fixes, done right.",
        desc: "Basic, code-safe fixes homeowners hire out — outlet and fixture swaps, panel labeling. Scope stays within what doesn't require a full electrician's license.",
        requiresLicense: true,
      },
      {
        tag: "Steady local demand",
        title: "Fence & Deck Repair",
        tagline: "Fences and decks, fixed for good.",
        desc: "Draws on hands-on building experience — one of the most requested jobs in residential neighborhoods.",
        requiresLicense: false,
      },
    ],
    setB: [
      {
        tag: "Low startup cost",
        title: "Drywall Patching & Interior Painting",
        tagline: "Clean patch-ups, no mess left behind.",
        desc: "Barely any extra equipment beyond what's already on hand, with fast, repeatable jobs.",
        requiresLicense: false,
      },
      {
        tag: "Recurring referrals",
        title: "Pre-Listing Home Repairs",
        tagline: "Homes, ready to list.",
        desc: "Partner with local real estate agents who need quick fixes before a house goes on the market.",
        requiresLicense: false,
      },
      {
        tag: "Growing trend",
        title: "Small-Scale Solar Panel Installation",
        tagline: "Solar, installed by someone local.",
        desc: "Few specialized providers in most areas yet — a chance to be early. Typically starts working under a licensed installer.",
        requiresLicense: true,
      },
    ],
  },
  cleaning: {
    setA: [
      {
        tag: "Recurring revenue",
        title: "Recurring Home Cleaning",
        tagline: "A clean home, on a schedule.",
        desc: "Weekly or biweekly cleans build a predictable, repeat-customer income base instead of one-off jobs.",
        requiresLicense: false,
      },
      {
        tag: "Higher ticket",
        title: "Move-In / Move-Out Deep Cleans",
        tagline: "Deep cleans for move day.",
        desc: "Higher price per job than a standard clean, and tenants/landlords often need it on short notice.",
        requiresLicense: false,
      },
      {
        tag: "B2B opportunity",
        title: "Small Office Cleaning",
        tagline: "Offices, cleaned after hours.",
        desc: "Small local offices are often underserved by the big commercial cleaning companies and pay reliably on contract.",
        requiresLicense: false,
      },
    ],
    setB: [
      {
        tag: "Low startup cost",
        title: "Post-Construction Cleaning",
        tagline: "The last step before move-in.",
        desc: "Contractors and renovators regularly need this and will refer repeat work if the job is done well.",
        requiresLicense: false,
      },
      {
        tag: "Growing trend",
        title: "Airbnb Turnover Cleaning",
        tagline: "Turnovers, done between guests.",
        desc: "Short-term rental hosts need fast, reliable turnaround between guests — often recurring, scheduled work.",
        requiresLicense: false,
      },
      {
        tag: "Specialty",
        title: "Window & Gutter Cleaning",
        tagline: "The clean most people skip.",
        desc: "Less competition than general home cleaning, and customers usually book it as a seasonal recurring job.",
        requiresLicense: false,
      },
    ],
  },
  landscaping: {
    setA: [
      {
        tag: "Recurring revenue",
        title: "Weekly Lawn Maintenance",
        tagline: "A yard that's always ready.",
        desc: "Weekly or biweekly visits build a predictable route of repeat customers in one area.",
        requiresLicense: false,
      },
      {
        tag: "Seasonal ticket",
        title: "Seasonal Yard Cleanup",
        tagline: "Yards, reset every season.",
        desc: "Spring and fall cleanups are high-demand, higher-ticket jobs that most homeowners don't want to do themselves.",
        requiresLicense: false,
      },
      {
        tag: "Higher ticket",
        title: "Garden Bed Design & Planting",
        tagline: "Gardens, designed and planted.",
        desc: "Design-and-install work has better margins than mowing alone, and referrals travel fast in a neighborhood.",
        requiresLicense: false,
      },
    ],
    setB: [
      {
        tag: "Recurring referrals",
        title: "Pre-Listing Curb Appeal",
        tagline: "Curb appeal, before the listing photos.",
        desc: "Partner with local real estate agents who need a yard looking sharp before photos go up.",
        requiresLicense: false,
      },
      {
        tag: "Specialty",
        title: "Irrigation & Sprinkler Repair",
        tagline: "Sprinklers, fixed for the season.",
        desc: "Less competition than mowing, and often becomes recurring seasonal maintenance work.",
        requiresLicense: false,
      },
      {
        tag: "Growing trend",
        title: "Small Tree & Shrub Care",
        tagline: "Trees and shrubs, kept healthy.",
        desc: "Homeowners increasingly want this handled by someone local rather than a large tree service.",
        requiresLicense: false,
      },
    ],
  },
  general: {
    setA: [
      {
        tag: "Flexible",
        title: "General Handyman Services",
        tagline: "The small jobs, handled.",
        desc: "A wide net of small home repairs and tasks is a fast way to start getting paid while a more specific niche becomes clear.",
        requiresLicense: false,
      },
      {
        tag: "Recurring revenue",
        title: "Errand & Task Support",
        tagline: "The to-do list, done for you.",
        desc: "Busy households and small businesses regularly pay for reliable help with recurring errands and small tasks.",
        requiresLicense: false,
      },
      {
        tag: "Low startup cost",
        title: "Organizing & Setup Help",
        tagline: "Spaces, sorted out.",
        desc: "Little to no equipment needed to start, and word-of-mouth travels quickly once a few jobs are done well.",
        requiresLicense: false,
      },
    ],
    setB: [
      {
        tag: "Recurring referrals",
        title: "Move-In / Move-Out Support",
        tagline: "Move day, made easier.",
        desc: "People moving need help fast and are often willing to pay a premium for someone reliable on short notice.",
        requiresLicense: false,
      },
      {
        tag: "Growing trend",
        title: "Senior Errand & Home Help",
        tagline: "Everyday help, close to home.",
        desc: "A steadily growing need in most areas, with customers who tend to become long-term, recurring clients.",
        requiresLicense: false,
      },
      {
        tag: "Specialty",
        title: "Event Setup & Breakdown",
        tagline: "Events, set up and packed down.",
        desc: "Local hosts and small venues regularly need reliable, short-notice help for setup and cleanup.",
        requiresLicense: false,
      },
    ],
  },
};

export function generateIdeas(cluster: Cluster, altSet: boolean, hasLicense: boolean): Idea[] {
  const pool = altSet ? IDEA_BANK[cluster].setB : IDEA_BANK[cluster].setA;
  // Swap out anything requiring a license the person doesn't have for the
  // next idea in the other set, so we never show an idea we'd immediately
  // have to rule out.
  const backup = (altSet ? IDEA_BANK[cluster].setA : IDEA_BANK[cluster].setB).filter(
    (i) => !i.requiresLicense
  );
  let backupIndex = 0;
  return pool.map((idea) => {
    if (idea.requiresLicense && !hasLicense) {
      const replacement = backup[backupIndex % backup.length];
      backupIndex += 1;
      return replacement;
    }
    return idea;
  });
}

export function generateRuledOut(cluster: Cluster, hasLicense: boolean): { title: string; reason: string }[] {
  if (hasLicense) return [];
  const allIdeas = [...IDEA_BANK[cluster].setA, ...IDEA_BANK[cluster].setB];
  const licensed = allIdeas.filter((i) => i.requiresLicense);
  const seen = new Set<string>();
  const ruledOut: { title: string; reason: string }[] = [];
  for (const idea of licensed) {
    if (seen.has(idea.title)) continue;
    seen.add(idea.title);
    ruledOut.push({
      title: idea.title,
      reason: "This scope of work needs a license you haven't mentioned having yet — the liability isn't worth the risk until that's in place.",
    });
  }
  return ruledOut.slice(0, 2);
}

export function generateAnalysis(answers: DiscoveryAnswers) {
  const { location, background, license, capacity } = answers;
  const cluster = detectCluster(background);
  const ownTools = hasOwnToolsSignal(capacity);
  const informalDemand = hasInformalDemandSignal(background);
  const place = location.trim() ? location.trim() : "where you are";

  const demandByCluster: Record<Cluster, string> = {
    construction: "steady, year-round demand for hands-on home repair and small building work — the kind that doesn't dry up when a season ends",
    cleaning: "consistent demand for reliable home and business cleaning, especially recurring, scheduled work",
    landscaping: "seasonal but reliable demand for yard and outdoor upkeep that most homeowners don't want to do themselves",
    general: "ongoing demand for dependable local help with the everyday tasks people don't have time for",
  };

  const localDemand = `In ${place}, there's ${demandByCluster[cluster]}.`;

  const yourFit = informalDemand
    ? `You mentioned people already come to you for this kind of help — that's a live signal of real, paying demand, not just a hunch. Combined with what you described (${background.trim().replace(/\.$/, "")}), that's a strong starting point.`
    : `Based on what you described (${background.trim().replace(/\.$/, "")}), you already have relevant hands-on experience to build on.`;

  const startupCost = ownTools
    ? "You already have the tools and equipment this kind of work needs — that's usually the biggest upfront cost, so you're starting with a higher margin than most."
    : "You'll likely need to budget for some basic tools or equipment before the first paid job — many people start small and reinvest as bookings come in.";

  const hasLicense = hasLicenseSignal(license);

  return {
    cluster,
    hasLicense,
    localDemand,
    yourFit,
    startupCost,
    ruledOut: generateRuledOut(cluster, hasLicense),
  };
}

export function generateDiscoveryPitch(opts: {
  name: string;
  idea: Idea;
  location: string;
  pricing: string;
}): string {
  const place = opts.location.trim() ? ` serving ${opts.location.trim()}` : "";
  return `${opts.name}${place}. ${opts.idea.desc} ${opts.pricing.trim()}.`.replace(/\s+/g, " ").trim();
}
