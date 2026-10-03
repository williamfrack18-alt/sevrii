// Marketing "brain": the owner's profile, the funnel strategy and campaigns
// that map 1:1 to Meta (Campaign → Ad set → Ad) and Google Search.
// Pure data + validation — used by the agent (server) and the UI (client).

export type MarketingProfile = {
  goal: string; // e.g. "more calls for AC repair"
  monthlyBudgetUsd: number | null;
  avgTicketUsd: number | null;
  mainService: string;
  idealCustomer: string;
  area: string;
  radiusMiles: number | null;
  customerLanguage: "es" | "en" | "both" | "";
  hasFacebookPage: boolean | null;
  hasAdAccount: boolean | null;
};

export type FunnelStage = {
  stage: "awareness" | "consideration" | "conversion" | "retention";
  title: string;
  channel: string;
  message: string;
  action: string;
};

export type Strategy = {
  summary: string;
  stages: FunnelStage[];
  budgetPlan: string;
};

export type MarketingData = { profile: MarketingProfile; strategy: Strategy | null };

export type MetaAd = { primaryText: string; headline: string; description: string };

export type CampaignSpec = {
  platform: "meta" | "google";
  objective: "calls" | "messages" | "leads" | "traffic";
  destination: "call" | "whatsapp" | "messenger" | "website";
  specialCategory: "none" | "credit" | "employment" | "housing" | "financial";
  city: string;
  radiusMiles: number;
  ageMin: number;
  ageMax: number;
  language: "es" | "en";
  dailyBudgetUsd: number;
  durationDays: number;
  ads: MetaAd[]; // Meta
  headlines: string[]; // Google RSA, ≤30 chars, up to 15
  descriptions: string[]; // Google RSA, ≤90 chars, up to 4
  keywords: string[];
  negativeKeywords: string[];
  notes: string;
};

export const EMPTY_PROFILE: MarketingProfile = {
  goal: "",
  monthlyBudgetUsd: null,
  avgTicketUsd: null,
  mainService: "",
  idealCustomer: "",
  area: "",
  radiusMiles: null,
  customerLanguage: "",
  hasFacebookPage: null,
  hasAdAccount: null,
};

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "";
}
function num(v: unknown, min: number, max: number): number | null {
  const n = typeof v === "string" ? Number(v.replace(/[^0-9.]/g, "")) : Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n * 100) / 100 : null;
}
function bool(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}
function list(v: unknown, max: number, len: number): string[] {
  return (Array.isArray(v) ? v : []).map((x) => str(x, len)).filter(Boolean).slice(0, max);
}

export function parseMarketing(raw: unknown): MarketingData {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const p = (o.profile && typeof o.profile === "object" ? o.profile : {}) as Record<string, unknown>;
  const s = (o.strategy && typeof o.strategy === "object" ? o.strategy : null) as Record<string, unknown> | null;
  const lang = p.customerLanguage;
  return {
    profile: {
      goal: str(p.goal, 160),
      monthlyBudgetUsd: num(p.monthlyBudgetUsd, 1, 1_000_000),
      avgTicketUsd: num(p.avgTicketUsd, 1, 1_000_000),
      mainService: str(p.mainService, 100),
      idealCustomer: str(p.idealCustomer, 240),
      area: str(p.area, 120),
      radiusMiles: num(p.radiusMiles, 1, 100),
      customerLanguage: lang === "es" || lang === "en" || lang === "both" ? lang : "",
      hasFacebookPage: bool(p.hasFacebookPage),
      hasAdAccount: bool(p.hasAdAccount),
    },
    strategy: s
      ? {
          summary: str(s.summary, 500),
          budgetPlan: str(s.budgetPlan, 400),
          stages: (Array.isArray(s.stages) ? s.stages : [])
            .map((x) => {
              const st = (x ?? {}) as Record<string, unknown>;
              const stage = ["awareness", "consideration", "conversion", "retention"].includes(String(st.stage))
                ? (st.stage as FunnelStage["stage"])
                : "conversion";
              return {
                stage,
                title: str(st.title, 80),
                channel: str(st.channel, 80),
                message: str(st.message, 240),
                action: str(st.action, 240),
              };
            })
            .filter((x) => x.title)
            .slice(0, 4),
        }
      : null,
  };
}

// ---------- Special ad categories (mandatory for US audiences on Meta) ----------
const SPECIAL: [CampaignSpec["specialCategory"], RegExp][] = [
  ["credit", /(cr[eé]dit|loan|pr[eé]stamo|lending|financ|mortgage|hipotec|debt|deuda)/i],
  ["housing", /(real estate|realtor|bienes ra[ií]ces|inmobiliar|rent(al)?s?\b|alquiler|apartment|apartamento|housing|vivienda)/i],
  ["employment", /(staffing|recruit|reclut|hiring agency|job (agency|placement)|agencia de empleo|bolsa de (trabajo|empleo))/i],
  ["financial", /(insurance|seguro de vida|tax prep|taxes|impuestos|invest|inversi)/i],
];

export function detectSpecialCategory(text: string): CampaignSpec["specialCategory"] {
  for (const [cat, re] of SPECIAL) if (re.test(text)) return cat;
  return "none";
}

// Turn whatever the AI proposed into a valid, safe campaign. Returns the
// cleaned spec plus warnings to show the owner.
export function normalizeCampaign(
  raw: Record<string, unknown>,
  ctx: { category: string; city: string; defaultLang: "es" | "en" }
): { spec: CampaignSpec; warnings: string[] } {
  const warnings: string[] = [];
  const platform = raw.platform === "google" ? "google" : "meta";
  const objective = (["calls", "messages", "leads", "traffic"] as const).includes(raw.objective as never)
    ? (raw.objective as CampaignSpec["objective"])
    : "calls";
  let destination = (["call", "whatsapp", "messenger", "website"] as const).includes(raw.destination as never)
    ? (raw.destination as CampaignSpec["destination"])
    : objective === "messages"
      ? "whatsapp"
      : objective === "calls"
        ? "call"
        : "website";
  if (platform === "google" && destination !== "call") destination = "website";

  // The category is decided by code from the business type, not only by the AI.
  const detected = detectSpecialCategory(ctx.category);
  const specialCategory = detected !== "none" ? detected : raw.specialCategory && raw.specialCategory !== "none" ? (raw.specialCategory as CampaignSpec["specialCategory"]) : "none";

  let radiusMiles = num(raw.radiusMiles, 1, 50) ?? 10;
  let ageMin = num(raw.ageMin, 18, 65) ?? 18;
  let ageMax = num(raw.ageMax, 18, 65) ?? 65;
  if (specialCategory !== "none") {
    // Meta rules for special categories in the US: 15+ mile radius, all ages 18–65+.
    if (radiusMiles < 15) {
      radiusMiles = 15;
      warnings.push("radius15");
    }
    ageMin = 18;
    ageMax = 65;
  }
  if (ageMin > ageMax) [ageMin, ageMax] = [ageMax, ageMin];

  const dailyBudgetUsd = num(raw.dailyBudgetUsd, 1, 10_000) ?? 10;
  const durationDays = Math.round(num(raw.durationDays, 1, 90) ?? 7);

  const ads: MetaAd[] = (Array.isArray(raw.ads) ? raw.ads : [])
    .map((a) => {
      const o = (a ?? {}) as Record<string, unknown>;
      return { primaryText: str(o.primaryText, 600), headline: str(o.headline, 80), description: str(o.description, 120) };
    })
    .filter((a) => a.primaryText || a.headline)
    .slice(0, 3);
  // Meta truncates long text on phones — warn, don't block.
  if (ads.some((a) => a.primaryText.length > 125 || a.headline.length > 40)) warnings.push("metaLong");

  // Google RSA limits are hard.
  const headlines = list(raw.headlines, 15, 200).filter((h) => h.length <= 30);
  const descriptions = list(raw.descriptions, 4, 300).filter((d) => d.length <= 90);
  if (platform === "google" && (headlines.length < 3 || descriptions.length < 2)) warnings.push("googleShort");

  const language = raw.language === "en" || raw.language === "es" ? raw.language : ctx.defaultLang;

  return {
    spec: {
      platform,
      objective,
      destination,
      specialCategory,
      city: str(raw.city, 80) || ctx.city,
      radiusMiles,
      ageMin,
      ageMax,
      language,
      dailyBudgetUsd,
      durationDays,
      ads,
      headlines,
      descriptions,
      keywords: list(raw.keywords, 20, 80),
      negativeKeywords: list(raw.negativeKeywords, 20, 80),
      notes: str(raw.notes, 400),
    },
    warnings,
  };
}

export function parseCampaignSpec(raw: unknown): CampaignSpec | null {
  if (!raw) return null;
  const o = typeof raw === "string" ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : raw;
  if (!o || typeof o !== "object") return null;
  return normalizeCampaign(o as Record<string, unknown>, { category: "", city: "", defaultLang: "es" }).spec;
}

// Meta may spend up to 75% more than the daily budget on a given day.
export function maxDailySpend(daily: number): number {
  return Math.round(daily * 1.75 * 100) / 100;
}

export function missingForMarketing(m: MarketingData, campaignCount: number): string[] {
  const p = m.profile;
  const out: string[] = [];
  if (!p.goal) out.push("goal");
  if (!p.mainService) out.push("mainService");
  if (p.monthlyBudgetUsd === null) out.push("monthlyBudgetUsd");
  if (!p.area) out.push("area");
  if (!p.idealCustomer) out.push("idealCustomer");
  if (!p.customerLanguage) out.push("customerLanguage");
  if (p.hasFacebookPage === null) out.push("hasFacebookPage");
  if (!m.strategy) out.push("strategy");
  if (campaignCount === 0) out.push("campaign");
  return out;
}
