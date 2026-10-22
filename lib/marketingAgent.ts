import "server-only";
import { MODELS, getClaude, logAiError } from "./claude";
import { textOf } from "./brain/common";
import type { Lang } from "./i18n";
import {
  addAgentItem,
  addMarketingPosts,
  businessWeekNumbers,
  campaignStats,
  getBusinessById,
  getMetaConnection,
  getUserById,
  listAgentItems,
  listCampaigns,
  listMarketingPosts,
  listServices,
  markAgentRan,
  setAgentItemStatus,
  setCampaignMeta,
  setCampaignStatus,
  updateBusinessMarketing,
  updateCampaignSpec,
  type AgentItemRow,
  type BusinessRow,
  type CampaignMeta,
  type CampaignRow,
  type MetaConnectionRow,
  type UserRow,
} from "./db";
import { limitsFor, siteUrl } from "./billing";
import { campaignLink } from "./campaignLink";
import { activeOffer, isOurBlob } from "./site";
import { maxDailySpend, normalizeCampaign, parseMarketing, type CampaignSpec, type MetaAd } from "./marketing";
import { campaignMoney, connectionToken, fetchSpend, fetchStats, launchCampaign, MetaError, metaReady, replaceAdCreative, setStatus } from "./meta";
import { allow } from "./guard";
import { researchGate, runForUser } from "./usage";
import type { AgentItem, AgentItemKind, AgentItemStatus, AgentNumbers, AgentPost, AgentPostChannel, AgentState } from "./agentTypes";

// The autonomous marketing agent. The marketing chat (lib/marketingBrain.ts)
// builds the strategy and campaigns with the owner; once the owner approves
// it, the agent puts it to work (executeStrategy) and then checks every
// campaign once a day (runDaily). The owner approves every launch and every
// budget increase; the agent may on its own only do things that never raise
// spend: pause a campaign that wastes money, write new ad texts, prepare free
// posts. Everything it does is logged as an agent item.

const DAY = 24 * 60 * 60 * 1000;
const MONTH_DAYS = 30;
const POSTS_TARGET = 8; // free posts ready when the strategy is approved
const POSTS_MIN = 4; // fewer upcoming than this → prepare more
const POSTS_REFILL = 6;

// ---------- small helpers ----------
const dayStr = (d: Date) => d.toISOString().slice(0, 10); // UTC
const today = () => dayStr(new Date());
const inDays = (n: number) => dayStr(new Date(Date.now() + n * DAY));
const langOf = (b: BusinessRow): Lang => (b.site.lang === "en" ? "en" : "es");
const floorCents = (n: number) => Math.floor(n * 100) / 100;
const quote = (s: string, lang: Lang) => (lang === "es" ? `«${s}»` : `“${s}”`);

export function money(n: number): string {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 })}`;
}

function rawAgentRanAt(b: BusinessRow): string | null {
  const v = (b as unknown as { agentRanAt?: unknown }).agentRanAt;
  if (!v) return null;
  const d = new Date(v as string);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

// The owner started the agent (it ran once, or left something for them).
export async function agentStarted(b: BusinessRow): Promise<boolean> {
  return Boolean(rawAgentRanAt(b)) || (await listAgentItems(b.id, 1)).length > 0;
}

// The Meta connection, only when the agent can really use it.
export function usableConnection(conn: MetaConnectionRow | null): MetaConnectionRow | null {
  if (!metaReady() || !conn || !conn.adAccountId || !conn.pageId) return null;
  return connectionToken(conn) ? conn : null;
}

const isLiveOnMeta = (c: CampaignRow) => Boolean(c.meta?.campaignId && c.meta.status === "active");

// What the campaigns that spend (or will, once approved) add up to in a month.
export function plannedCampaigns(campaigns: CampaignRow[], excludeId?: string): CampaignRow[] {
  return campaigns.filter(
    (c) => c.id !== excludeId && c.spec && (isLiveOnMeta(c) || (!c.meta?.campaignId && (c.status === "approved" || c.status === "proposed")))
  );
}
export function monthlyOf(c: CampaignRow): number {
  return (c.spec?.dailyBudgetUsd ?? 0) * MONTH_DAYS;
}
export function plannedMonthly(campaigns: CampaignRow[], excludeId?: string): number {
  return plannedCampaigns(campaigns, excludeId).reduce((s, c) => s + monthlyOf(c), 0);
}

// Photos the page has, as indexes in [cover, ...gallery].
function photoSlots(b: BusinessRow): number[] {
  return [b.site.coverUrl, ...b.site.gallery].map((u, i) => (u ? i : -1)).filter((i) => i >= 0);
}
function adImage(b: BusinessRow): string | null {
  return [b.site.coverUrl, ...b.site.gallery].find((u) => u && isOurBlob(u)) || null;
}
const isLocal = (b: BusinessRow) => b.site.reachMode === "local";

function customerLangs(b: BusinessRow): "es" | "en" | "both" {
  const l = b.marketing.profile.customerLanguage || b.plan.profile.languages;
  if (l === "es" || l === "en" || l === "both") return l;
  return b.site.spanish && b.site.lang === "en" ? "both" : langOf(b);
}

function where(b: BusinessRow, spec: CampaignSpec, lang: Lang): string {
  const s = b.site;
  if (s.reachMode === "local" && s.baseLat !== null && s.baseLon !== null) {
    const min = spec.specialCategory !== "none" ? 15 : 1;
    const radius = Math.min(50, Math.max(min, Math.round(spec.radiusMiles || s.reachRadius || 10)));
    const place = s.baseCity || spec.city || b.city || "";
    return lang === "es" ? `${radius} millas alrededor de ${place || "tu negocio"}` : `${radius} miles around ${place || "your business"}`;
  }
  if (s.reachMode === "remote" && s.reachScope === "state" && s.baseState) return lang === "es" ? `todo el estado de ${s.baseState}` : `the whole state of ${s.baseState}`;
  return lang === "es" ? "todo EE. UU." : "the whole US";
}

function recentItem(items: AgentItemRow[], kind: string, campaignId: string | null, days: number, statuses?: string[]): boolean {
  const since = Date.now() - days * DAY;
  return items.some(
    (i) => i.kind === kind && (campaignId === null || i.campaignId === campaignId) && Date.parse(i.createdAt) >= since && (!statuses || statuses.includes(i.status))
  );
}

// ---------- facts the AI may use (and nothing else) ----------
// Also what the marketing chat knows before asking anything.
export async function businessFacts(b: BusinessRow) {
  const services = await listServices(b.id);
  const s = b.site;
  const p = b.plan;
  const reach =
    s.reachMode === "remote"
      ? s.reachScope === "world"
        ? "online, customers in the US and other countries"
        : s.reachScope === "state" && s.baseState
          ? `online, only customers in the state of ${s.baseState}`
          : "online, customers in the whole US"
      : s.reachMode === "local"
        ? `in person, ${s.reachRadius || 10} miles around ${[s.baseCity, s.baseState].filter(Boolean).join(", ") || b.city || "the business"}`
        : "unknown";
  return {
    business: { name: b.name, category: b.category, description: b.description, pitch: b.pitch, city: b.city },
    page: {
      language: langOf(b),
      headline: s.headline,
      reach,
      serviceArea: s.serviceArea,
      services: services.map((x) => ({ name: x.name, price: x.price, description: x.description })),
      offer: activeOffer(s),
      keyPoints: s.keyPoints.map((k) => `${k.title}: ${k.text}`),
      highlights: s.highlights,
      spanishSpoken: s.spanish,
      yearsInBusiness: s.yearsInBusiness,
      insured: s.insured,
      licensed: Boolean(s.licenseNumber),
      ownerName: s.ownerName,
      photoCount: photoSlots(b).length,
    },
    brainPlan: p.service
      ? {
          service: p.service,
          customer: p.customer,
          problem: p.problem,
          fears: p.fears,
          promise: p.promise,
          differentiators: p.differentiators,
          // Prices/offer for ads come from the page (page.services / page.offer).
          campaignType: p.campaignType,
          channels: p.channels,
          photoIdeas: p.photoIdeas,
          videoScript: p.videoScript,
          // What to keep in mind for ads (e.g. Meta's special ad categories).
          notes: p.guard.warn,
        }
      : null,
    marketingProfile: b.marketing.profile,
    strategy: b.marketing.strategy,
    customersLanguage: customerLangs(b),
  };
}

const RULES = `Rules (always):
- Customers reach the business ONLY through the AI chat on its Sevrii page. Every ad sends people to that page ("Learn more"). Say "write to us through the chat on our page", never "call", "text", "WhatsApp" or "the number below".
- Prices and offers come ONLY from page.services and page.offer (what customers actually see on the page). The Brain plan's packages/prices may be outdated: never quote them.
- Use ONLY facts given (services, prices, offer, area, key points, Brain plan). NEVER invent prices, discounts, guarantees, licenses, insurance, years, reviews, customer counts or results. No "#1", no "guaranteed", no fake urgency.
- Never promise leads, calls, chats, cost per lead or ROI.
- Meta policy: never assert or imply personal attributes ("Are you divorced?", "Do you have debt?", "Struggling with your weight?"). Target only by location and ad language, never by ethnicity, religion or other personal attributes.
- Plain, warm, short sentences a neighbor would write. No emojis. No hashtags spam (at most 2 on Instagram).`;

const LANG_NOTE = (l: Lang) => (l === "es" ? "Spanish (neutral US Spanish, 'tú')" : "plain US English");

// ---------- structured AI calls ----------
const S = (description: string) => ({ type: "string", description });
const obj = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, properties, required: Object.keys(properties) });
const AD = obj({
  primaryText: S("Main ad text, ideally ≤125 characters, benefit first, ends inviting to write through the page chat"),
  headline: S("≤40 characters"),
  description: S("≤30 characters, or empty string"),
});
const POST = obj({
  channel: { type: "string", enum: ["facebook", "instagram", "google"] },
  dayOffset: { type: "integer", description: "Days from today, 1 to 14" },
  text: S("The post text, ready to paste"),
  photo: { type: "integer", description: "Index of the page photo to use (0 to photoCount-1), 0 if there are none" },
});

async function ask(opts: {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  model?: string;
  maxTokens: number;
  effort: "low" | "medium";
  think: boolean;
  timeoutMs: number;
}): Promise<Record<string, unknown>> {
  const client = getClaude(opts.timeoutMs);
  if (!client) throw new Error("ANTHROPIC_API_KEY is not set");
  const res = await client.messages.create(
    {
      model: opts.model || MODELS.chat,
      max_tokens: opts.maxTokens,
      thinking: opts.think ? { type: "adaptive" } : { type: "disabled" },
      output_config: { effort: opts.effort, format: { type: "json_schema", schema: opts.schema } },
      system: opts.system,
      messages: [{ role: "user", content: opts.user }],
    },
    { timeout: opts.timeoutMs }
  );
  if (res.stop_reason === "max_tokens" || res.stop_reason === "refusal") throw new Error(`AI stopped: ${res.stop_reason}`);
  return JSON.parse(textOf(res.content)) as Record<string, unknown>;
}

// AI posts → rows for the table (valid channel, day and photo).
function cleanPosts(b: BusinessRow, raw: unknown, max: number): { channel: AgentPostChannel; day: string; text: string; photo: number }[] {
  const slots = photoSlots(b);
  const local = isLocal(b);
  const out: { channel: AgentPostChannel; day: string; text: string; photo: number }[] = [];
  for (const x of Array.isArray(raw) ? raw : []) {
    const o = (x ?? {}) as Record<string, unknown>;
    let channel: AgentPostChannel = o.channel === "instagram" ? "instagram" : o.channel === "google" ? "google" : "facebook";
    if (channel === "google" && !local) channel = "facebook"; // Google Business is for in-person businesses
    const text = typeof o.text === "string" ? o.text.trim().slice(0, channel === "google" ? 1500 : 2200) : "";
    if (!text) continue;
    const offset = Math.min(14, Math.max(1, Math.round(Number(o.dayOffset) || out.length + 1)));
    const want = Math.round(Number(o.photo) || 0);
    const photo = slots.length ? (slots.includes(want) ? want : slots[out.length % slots.length]) : 0;
    out.push({ channel, day: inDays(offset), text, photo });
    if (out.length >= max) break;
  }
  return out;
}

// ---------- putting the approved strategy to work ----------
function launchTexts(b: BusinessRow, title: string, spec: CampaignSpec, audience: string, why: string) {
  const lang = langOf(b);
  const d = spec.dailyBudgetUsd;
  const es = lang === "es";
  const special =
    spec.specialCategory !== "none"
      ? es
        ? " Por el tipo de negocio, Facebook pide mostrar el anuncio a todas las edades y en 15 millas o más."
        : " Because of the type of business, Facebook requires showing the ad to all ages and in 15 miles or more."
      : "";
  // The AI's sentences may already end with a period: never print "..".
  const clip = (x: string) => x.trim().replace(/[.\s]+$/, "");
  audience = clip(audience);
  why = clip(why);
  const meta = spec.platform === "meta";
  const peakEs = meta ? ` (Facebook puede gastar hasta ${money(maxDailySpend(d))} un día y menos otro)` : "";
  const peakEn = meta ? ` (Facebook may spend up to ${money(maxDailySpend(d))} one day and less another)` : "";
  return {
    title: es ? `Lanzar ${quote(title, lang)} — ${money(d)} al día por ${spec.durationDays} días` : `Launch ${quote(title, lang)} — ${money(d)} a day for ${spec.durationDays} days`,
    detail: es
      ? `Para quién: ${audience || "clientes de tu zona"}. Dónde: ${where(b, spec, lang)}. Cuánto: ${money(d)} al día, unos ${money(d * spec.durationDays)} en total${peakEs}. Por qué: ${why || "trae gente a tu página para que te escriba por el chat"}. El anuncio lleva a tu página, donde te escriben por el chat.${special}`
      : `Who: ${audience || "customers in your area"}. Where: ${where(b, spec, lang)}. How much: ${money(d)} a day, about ${money(d * spec.durationDays)} in total${peakEn}. Why: ${why || "it brings people to your page to write to you in the chat"}. The ad sends people to your page, where they write to you in the chat.${special}`,
  };
}

export type ExecuteResult =
  | { ok: true; campaigns: number; posts: number }
  | { ok: false; reason: "no_strategy" | "no_campaigns" | "no_budget" | "over_budget"; totalUsd?: number; budgetUsd?: number };

// Campaigns that wait for (or already have) the owner's decision on launching.
const DECIDED = ["proposed", "approved", "live", "paused", "declined"];

// The owner approved the strategy the marketing chat built. Nothing new is
// invented here: the chat's campaigns become launch proposals (one OK each),
// the free posts are prepared and the daily check starts watching.
// Re-approving after changes only proposes the campaigns that are new or changed.
export async function executeStrategy(business: BusinessRow, lang: Lang, opts: { posts?: boolean } = {}): Promise<ExecuteResult> {
  const b = business;
  const strategy = b.marketing.strategy;
  if (!strategy) return { ok: false, reason: "no_strategy" };
  const budget = b.marketing.profile.monthlyBudgetUsd;
  if (!budget) return { ok: false, reason: "no_budget" };
  const [campaigns, items] = await Promise.all([listCampaigns(b.id), listAgentItems(b.id, 200)]);
  if (!campaigns.some((c) => c.spec)) return { ok: false, reason: "no_campaigns" };

  const pendingLaunch = (id: string) => items.some((i) => i.kind === "launch" && i.status === "pending" && i.campaignId === id);
  // Proposals left over from campaigns the chat deleted or changed.
  for (const it of items) {
    if (it.kind !== "launch" || it.status !== "pending") continue;
    const c = it.campaignId ? campaigns.find((x) => x.id === it.campaignId) : undefined;
    if (!c || c.status !== "proposed") await setAgentItemStatus(b.id, it.id, "dismissed");
  }
  const toPropose = campaigns.filter(
    (c) => c.spec && (c.status === "proposed" ? !pendingLaunch(c.id) : !DECIDED.includes(c.status))
  );

  // What everything adds up to once these are approved: never over the owner's maximum.
  const total = plannedMonthly(campaigns) + toPropose.filter((c) => c.status !== "proposed").reduce((s, c) => s + monthlyOf(c), 0);
  if (total > budget + 0.5) return { ok: false, reason: "over_budget", totalUsd: Math.round(total * 100) / 100, budgetUsd: budget };

  return runForUser(b.userId, async () => {
    const marketing = parseMarketing({ ...b.marketing, approvedAt: new Date().toISOString() });
    await updateBusinessMarketing(b.id, marketing);

    let made = 0;
    for (const c of toPropose) {
      const spec = c.spec!;
      await setCampaignStatus(b.id, c.id, "proposed");
      const t = launchTexts(b, c.title, spec, b.marketing.profile.idealCustomer || b.plan.customer || "", c.goal || "");
      await addAgentItem({
        businessId: b.id,
        kind: "launch",
        status: "pending",
        title: t.title,
        detail: t.detail,
        campaignId: c.id,
        payload: { dailyBudgetUsd: spec.dailyBudgetUsd, durationDays: spec.durationDays },
      });
      made++;
    }

    // Free posts: top up to POSTS_TARGET upcoming (re-approving doesn't pile them up).
    let posts = 0;
    if (opts.posts !== false && process.env.ANTHROPIC_API_KEY) {
      try {
        const all = await listMarketingPosts(b.id, inDays(-14), 80);
        const upcoming = all.filter((p) => p.day >= today() && p.status === "ready").length;
        const want = Math.max(0, POSTS_TARGET - upcoming);
        if (want > 0) {
          const fresh = { ...b, marketing };
          const list = await morePosts(fresh, all.map((p) => ({ day: p.day, channel: p.channel, text: p.text.slice(0, 160) })), want);
          if (list.length) await addMarketingPosts(b.id, list);
          posts = list.length;
        }
      } catch (err) {
        // The daily check prepares them later.
        logAiError("agent:execute:posts", err);
      }
    }

    const es = lang === "es";
    await addAgentItem({
      businessId: b.id,
      kind: "info",
      status: "auto",
      title: es
        ? `Puse en marcha tu estrategia: ${made} ${made === 1 ? "campaña lista" : "campañas listas"} para aprobar y ${posts} ${posts === 1 ? "publicación" : "publicaciones"}`
        : `I put your strategy to work: ${made} ${made === 1 ? "campaign" : "campaigns"} ready for your OK and ${posts} ${posts === 1 ? "post" : "posts"}`,
      detail: [strategy.summary, strategy.budgetPlan].filter(Boolean).join(" "),
    });
    await markAgentRan(b.id);
    return { ok: true as const, campaigns: made, posts };
  });
}

// ---------- launching on Meta (after the owner's OK) ----------
export function metaFriendly(err: unknown, lang: Lang): string {
  const es = lang === "es";
  if (err instanceof MetaError) {
    if (err.message === "reconnect" || err.code === 190)
      return es ? "La conexión con Facebook venció. Vuelve a conectar Facebook." : "The Facebook connection expired. Connect Facebook again.";
    if (err.message === "account_inactive")
      return es ? "Tu cuenta publicitaria no está activa. Revísala en el Administrador de anuncios de Meta." : "Your ad account isn't active. Check it in Meta Ads Manager.";
    if (err.message === "currency")
      return es ? "Tu cuenta publicitaria no usa dólares (USD). Usa una cuenta en USD." : "Your ad account doesn't use US dollars (USD). Use a USD account.";
    return es ? `Facebook respondió: ${err.message}` : `Facebook said: ${err.message}`;
  }
  return es ? "No se pudo completar. Inténtalo de nuevo más tarde." : "Couldn't finish. Try again later.";
}

// Creates the campaign on Meta (paused) if it isn't there, then turns it on.
export async function launchOnMeta(
  b: BusinessRow,
  c: CampaignRow,
  conn: MetaConnectionRow
): Promise<{ ok: true; meta: CampaignMeta } | { ok: false; error: string }> {
  const lang = langOf(b);
  if (!c.spec || c.spec.platform !== "meta") return { ok: false, error: lang === "es" ? "Esta campaña no es para Facebook o Instagram." : "This campaign isn't for Facebook or Instagram." };
  // Same lock as the manual launch button, so both can't create it twice.
  if (!(await allow(`meta:launch:${b.id}:${c.id}`, 1, 120))) return { ok: false, error: lang === "es" ? "Ya se está publicando. Espera un momento." : "It's already being published. Wait a moment." };
  try {
    let meta: CampaignMeta | null = c.meta?.campaignId && c.meta.adSetId && c.meta.adId ? c.meta : null;
    if (!meta) {
      meta = await launchCampaign(conn, b, c, campaignLink(b.slug, c.id, siteUrl()), adImage(b));
      await setCampaignMeta(b.id, c.id, meta);
    }
    if (meta.status !== "active") {
      await setStatus(conn, meta, "ACTIVE", campaignMoney(c.spec).days);
      meta = { ...meta, status: "active", error: undefined };
      await setCampaignMeta(b.id, c.id, meta);
    }
    await setCampaignStatus(b.id, c.id, "live");
    return { ok: true, meta };
  } catch (err) {
    return { ok: false, error: metaFriendly(err, lang) };
  }
}

export function launchedText(b: BusinessRow, c: CampaignRow): { title: string; detail: string } {
  const lang = langOf(b);
  const d = c.spec?.dailyBudgetUsd ?? 0;
  const days = c.spec?.durationDays ?? MONTH_DAYS;
  return lang === "es"
    ? {
        title: `Publiqué ${quote(c.title, lang)} en Facebook e Instagram`,
        detail: `Corre ${days} días con ${money(d)} al día. Facebook revisa el anuncio antes de mostrarlo (suele tardar unas horas). Yo lo reviso cada día.`,
      }
    : {
        title: `I published ${quote(c.title, lang)} on Facebook and Instagram`,
        detail: `It runs ${days} days at ${money(d)} a day. Facebook reviews the ad before showing it (usually a few hours). I check it every day.`,
      };
}

export function readyToPublishText(b: BusinessRow, c: CampaignRow): { title: string; detail: string } {
  const lang = langOf(b);
  if (c.spec?.platform === "google")
    return lang === "es"
      ? { title: `Lista para Google: ${quote(c.title, lang)}`, detail: "Cópiala a Google Ads siguiendo los pasos de la campaña en Marketing. Usa su link para que Sevrii cuente lo que trae." }
      : { title: `Ready for Google: ${quote(c.title, lang)}`, detail: "Copy it into Google Ads following the campaign's steps in Marketing. Use its link so Sevrii counts what it brings." };
  return lang === "es"
    ? {
        title: `Lista para publicar: ${quote(c.title, lang)}`,
        detail: "Conecta Facebook para que la publique sola, o cópiala al Administrador de anuncios.",
      }
    : {
        title: `Ready to publish: ${quote(c.title, lang)}`,
        detail: "Connect Facebook so I can publish it for you, or copy it into Ads Manager.",
      };
}

// ---------- new ad texts ----------
const ADS_SYSTEM = `You rewrite the ads of one Meta campaign for a small US service business. The current ads bring visits to the page but nobody writes in the chat. Write 3 NEW variations with different angles (a clear benefit, the offer or price if it exists in the facts, the owner and how the job works, an answer to a common worry). Keep the same service and the same facts. Benefit first, ≤125 characters of main text, headline ≤40 characters, and invite people to write through the chat on the page.

${RULES}`;

async function rewriteAds(b: BusinessRow, c: CampaignRow, numbers: { views: number; chats: number }): Promise<MetaAd[]> {
  const spec = c.spec!;
  const out = await ask({
    system: ADS_SYSTEM,
    user: `Facts (JSON):\n${JSON.stringify(await businessFacts(b))}\n\nCampaign: ${JSON.stringify({ title: c.title, goal: c.goal, currentAds: spec.ads })}\nLast 7 days: ${numbers.views} visits to the page from this campaign, ${numbers.chats} chats.\nWrite the ads in ${LANG_NOTE(spec.language)}.`,
    schema: obj({ ads: { type: "array", items: AD, description: "Exactly 3 new variations" } }),
    maxTokens: 2000,
    effort: "low",
    think: false,
    timeoutMs: 60_000,
  });
  return normalizeCampaign({ ...spec, ads: out.ads }, { category: b.category, city: spec.city, defaultLang: spec.language }).spec.ads;
}

// ---------- more free posts ----------
const POSTS_SYSTEM = `You prepare free social posts for one small US service business: Facebook, Instagram and Google Business Profile (google ONLY if the business works in person in an area). Short and natural (Facebook 40-90 words, Instagram 30-70 words + up to 2 hashtags, Google 30-80 words, no hashtags). Vary the angle (the service, how it works, the offer, a tip, the owner and their work, a common worry) and don't repeat the recent posts. No links or URLs (the app adds the page link). Spread them over the next 14 days (dayOffset 1-14), at most one per channel per day. photo = index of a page photo (0..photoCount-1).

${RULES}`;

async function morePosts(b: BusinessRow, recent: { day: string; channel: string; text: string }[], count = POSTS_REFILL) {
  const n = Math.max(1, Math.min(POSTS_TARGET, count));
  const out = await ask({
    system: POSTS_SYSTEM,
    user: `Facts (JSON):\n${JSON.stringify(await businessFacts(b))}\n\nRecent and planned posts (don't repeat them, avoid their days): ${JSON.stringify(recent.slice(-10))}\nToday is ${today()}. Follow the strategy in the facts when there is one. Write exactly ${n} posts in ${LANG_NOTE(langOf(b))}.`,
    schema: obj({ posts: { type: "array", items: POST, description: `Exactly ${n} posts` } }),
    maxTokens: 4000,
    effort: "low",
    think: false,
    timeoutMs: 60_000,
  });
  return cleanPosts(b, out.posts, n);
}

// ---------- the daily check ----------
export async function runDaily(businessId: string): Promise<string> {
  const b = await getBusinessById(businessId);
  if (!b) return "not found";
  const owner = await getUserById(b.userId);
  if (!owner) return "no owner";
  const limits = limitsFor(owner);
  if (!limits.autoMarketing) return "agent not in plan (Pro)";

  return runForUser(b.userId, async () => {
    const lang = langOf(b);
    const es = lang === "es";
    const done: string[] = [];
    const conn = usableConnection(await getMetaConnection(b.id));
    const [campaigns, items] = await Promise.all([listCampaigns(b.id), listAgentItems(b.id, 200)]);
    const week = await campaignStats(b.id, new Date(Date.now() - 7 * DAY));
    const budget = b.marketing.profile.monthlyBudgetUsd;
    const canAi = async () => Boolean(process.env.ANTHROPIC_API_KEY) && (await researchGate(b.userId, limits, { budgetOnly: true })) === null;
    const log = (i: { kind: AgentItemKind; status: AgentItemStatus; title: string; detail?: string; campaignId?: string | null; payload?: Record<string, unknown> }) =>
      addAgentItem({ businessId: b.id, ...i });

    for (const c of campaigns) {
      try {
        const spec = c.spec;
        // Proposals the owner hasn't approved: nothing to do.
        if (!spec || c.status === "proposed" || c.status === "declined") continue;

        // Approved while Facebook wasn't connected: publish it now that it is.
        if (c.status === "approved" && !isLiveOnMeta(c) && conn && b.published && limits.canPublish && spec.platform === "meta") {
          const r = await launchOnMeta(b, c, conn);
          if (r.ok) {
            await log({ kind: "launch", status: "auto", campaignId: c.id, ...launchedText(b, c) });
            done.push("launched");
          } else if (!recentItem(items, "launch", c.id, 3, ["error"])) {
            await log({ kind: "launch", status: "error", campaignId: c.id, title: es ? `No pude publicar ${quote(c.title, lang)}` : `I couldn't publish ${quote(c.title, lang)}`, detail: r.error });
          }
          continue;
        }

        // Live on Meta: read its numbers.
        if (isLiveOnMeta(c) && conn && c.meta) {
          const meta = c.meta;
          let stats: CampaignMeta["stats"] | null = null;
          let review: string | undefined;
          try {
            const r = await fetchStats(conn, meta);
            review = r.review;
            stats = { spend: r.spend, impressions: r.impressions, clicks: r.clicks, at: r.at };
            await setCampaignMeta(b.id, c.id, { ...meta, stats });
          } catch (err) {
            console.error("[agent] stats failed", b.id, c.id, (err as Error)?.message);
          }

          if ((review === "DISAPPROVED" || review === "WITH_ISSUES") && !recentItem(items, "info", c.id, 7)) {
            await log({
              kind: "info",
              status: "auto",
              campaignId: c.id,
              title: es ? `Facebook marcó un problema con ${quote(c.title, lang)}` : `Facebook flagged a problem with ${quote(c.title, lang)}`,
              detail: es ? "Revisa el anuncio en el Administrador de anuncios de Meta. Mañana pruebo con textos nuevos si sigue sin mostrarse." : "Check the ad in Meta Ads Manager. Tomorrow I'll try new texts if it still isn't showing.",
            });
          }

          if (stats) {
            const since = Date.parse(meta.launchedAt) || Date.now();
            const daysLive = (Date.now() - since) / DAY;
            const chats = (await campaignStats(b.id, new Date(since)))[c.id]?.chats ?? 0;
            const daily = spec.dailyBudgetUsd;

            // Spending with nobody writing: stop it (never needs the owner's OK).
            if (daysLive >= 3 && stats.spend >= 2 * daily && chats === 0) {
              try {
                await setStatus(conn, meta, "PAUSED");
                await setCampaignMeta(b.id, c.id, { ...meta, stats, status: "paused" });
                await setCampaignStatus(b.id, c.id, "paused");
                await log({
                  kind: "pause",
                  status: "auto",
                  campaignId: c.id,
                  title: es ? `Pausé ${quote(c.title, lang)}: gastó sin traer chats` : `I paused ${quote(c.title, lang)}: it spent without bringing chats`,
                  detail: es
                    ? `En ${Math.floor(daysLive)} días gastó ${money(stats.spend)} y nadie escribió por el chat (${stats.clicks} clics). La pausé para no seguir gastando. Puedes volver a activarla desde Marketing cuando quieras.`
                    : `In ${Math.floor(daysLive)} days it spent ${money(stats.spend)} and no one wrote in the chat (${stats.clicks} clicks). I paused it so it stops spending. You can turn it back on from Marketing whenever you want.`,
                  payload: { spend: stats.spend, chats, clicks: stats.clicks, days: Math.floor(daysLive) },
                });
                done.push("paused");
              } catch (err) {
                console.error("[agent] pause failed", b.id, c.id, (err as Error)?.message);
              }
              continue;
            }

            // Bringing chats cheaply: suggest a bit more budget (the owner decides).
            const ticket = b.marketing.profile.avgTicketUsd;
            const target = ticket ? ticket / 2 : 15;
            if (budget && chats >= 3 && stats.spend > 0 && stats.spend / chats < target && !recentItem(items, "budget", c.id, 7) && !items.some((i) => i.kind === "budget" && i.campaignId === c.id && i.status === "pending")) {
              const room = budget - plannedMonthly(campaigns, c.id);
              const to = Math.min(Math.round(daily * 1.3 * 100) / 100, floorCents(room / MONTH_DAYS));
              if (to >= daily + 1) {
                const perChat = stats.spend / chats;
                await log({
                  kind: "budget",
                  status: "pending",
                  campaignId: c.id,
                  title: es ? `Subir ${quote(c.title, lang)} a ${money(to)} al día` : `Raise ${quote(c.title, lang)} to ${money(to)} a day`,
                  detail: es
                    ? `Va bien: ${chats} chats por ${money(stats.spend)}, unos ${money(perChat)} por chat. Pasaría de ${money(daily)} a ${money(to)} al día (unos ${money(to * MONTH_DAYS)} al mes). Con tus otras campañas sigues dentro de tu máximo de ${money(budget)} al mes.`
                    : `It's working: ${chats} chats for ${money(stats.spend)}, about ${money(perChat)} per chat. It would go from ${money(daily)} to ${money(to)} a day (about ${money(to * MONTH_DAYS)} a month). With your other campaigns you stay within your ${money(budget)} monthly maximum.`,
                  payload: { fromDaily: daily, toDaily: to },
                });
                done.push("budget");
              }
            }
          }
        }

        // Visits but nobody writes: new ad texts (at most once a week per campaign).
        const w = week[c.id] ?? { views: 0, chats: 0, contacts: 0 };
        if (spec.platform === "meta" && w.views >= 40 && w.chats === 0 && !recentItem(items, "variation", c.id, 7) && (await canAi())) {
          const ads = await rewriteAds(b, c, w);
          if (ads.length) {
            const next = { ...spec, ads };
            await updateCampaignSpec(c.id, b.id, c.title, c.goal, next);
            let onMeta = false;
            if (isLiveOnMeta(c) && conn && c.meta) {
              try {
                await replaceAdCreative(conn, { ...c, spec: next }, c.meta, campaignLink(b.slug, c.id, siteUrl()), adImage(b));
                onMeta = true;
              } catch (err) {
                console.error("[agent] creative swap failed", b.id, c.id, (err as Error)?.message);
              }
            }
            await log({
              kind: "variation",
              status: "auto",
              campaignId: c.id,
              title: es ? `Escribí anuncios nuevos para ${quote(c.title, lang)}` : `I wrote new ads for ${quote(c.title, lang)}`,
              detail: es
                ? `En 7 días llegaron ${w.views} visitas y nadie escribió. Cambié los textos con los mismos datos de tu negocio, sin subir el gasto.${onMeta ? " Facebook los revisa antes de mostrarlos." : isLiveOnMeta(c) ? " Ya están en la campaña; en Facebook se verán cuando la vuelvas a publicar." : " Cópialos a tu anuncio para usarlos."} Nuevo texto: "${ads[0].primaryText}"`
                : `In 7 days ${w.views} people visited and no one wrote. I changed the texts using the same facts about your business, without raising spend.${onMeta ? " Facebook reviews them before showing them." : isLiveOnMeta(c) ? " They're saved in the campaign; Facebook will show them when it's published again." : " Copy them into your ad to use them."} New text: "${ads[0].primaryText}"`,
            });
            done.push("variation");
          }
        }
      } catch (err) {
        console.error("[agent] campaign check failed", b.id, c.id, (err as Error)?.message);
      }
    }

    // Free posts: keep a couple of weeks ready.
    try {
      const all = await listMarketingPosts(b.id, inDays(-14), 80);
      const upcoming = all.filter((p) => p.day >= today() && p.status === "ready");
      if (upcoming.length < POSTS_MIN && (await canAi())) {
        const posts = await morePosts(b, all.map((p) => ({ day: p.day, channel: p.channel, text: p.text.slice(0, 160) })));
        if (posts.length) {
          await addMarketingPosts(b.id, posts);
          await log({
            kind: "info",
            status: "auto",
            title: es ? `Preparé ${posts.length} publicaciones gratis para las próximas 2 semanas` : `I prepared ${posts.length} free posts for the next 2 weeks`,
            detail: es ? "Cópialas en Facebook, Instagram o Google el día que dice cada una." : "Copy them to Facebook, Instagram or Google on the day each one says.",
          });
          done.push("posts");
        }
      }
    } catch (err) {
      logAiError("agent:posts", err);
    }

    await markAgentRan(b.id);
    return done.length ? done.join(", ") : "nothing to do";
  });
}

// ---------- what the dashboard shows ----------
const KINDS: AgentItemKind[] = ["launch", "budget", "variation", "pause", "resume", "info"];
const STATUSES: AgentItemStatus[] = ["pending", "approved", "done", "dismissed", "auto", "error"];

function toItem(r: AgentItemRow): AgentItem {
  return {
    id: r.id,
    kind: KINDS.includes(r.kind as AgentItemKind) ? (r.kind as AgentItemKind) : "info",
    status: STATUSES.includes(r.status as AgentItemStatus) ? (r.status as AgentItemStatus) : "done",
    title: r.title,
    detail: r.detail,
    campaignId: r.campaignId,
    createdAt: r.createdAt,
    resolvedAt: r.resolvedAt,
  };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);
}

// What campaigns on Meta spent in a window; null when it can't be known.
async function spendIn(conn: MetaConnectionRow | null, campaigns: CampaignRow[], since: string, until: string): Promise<number | null> {
  const onMeta = campaigns.filter((c) => c.meta?.campaignId);
  if (!conn || onMeta.length === 0) return null;
  try {
    const all = await withTimeout(Promise.all(onMeta.map((c) => fetchSpend(conn, c.meta!, since, until))), 6000);
    return Math.round(all.reduce((a, b) => a + b, 0) * 100) / 100;
  } catch {
    return null;
  }
}

export async function agentState(business: BusinessRow, user: UserRow): Promise<AgentState> {
  const b = business;
  const now = new Date();
  const d7 = new Date(now.getTime() - 7 * DAY);
  const d14 = new Date(now.getTime() - 14 * DAY);
  const [rows, postRows, rawConn, campaigns, w, p, s7, s14] = await Promise.all([
    listAgentItems(b.id, 120),
    listMarketingPosts(b.id, today(), 40),
    getMetaConnection(b.id),
    listCampaigns(b.id),
    businessWeekNumbers(b.id, d7, now),
    businessWeekNumbers(b.id, d14, d7),
    campaignStats(b.id, d7),
    campaignStats(b.id, d14),
  ]);
  const conn = usableConnection(rawConn);
  const views7 = Object.values(s7).reduce((a, s) => a + s.views, 0);
  const views14 = Object.values(s14).reduce((a, s) => a + s.views, 0);
  const [spend7, spendPrev] = await Promise.all([
    spendIn(conn, campaigns, dayStr(new Date(now.getTime() - 6 * DAY)), dayStr(now)),
    spendIn(conn, campaigns, dayStr(new Date(now.getTime() - 13 * DAY)), dayStr(d7)),
  ]);

  const items = rows.map(toItem);
  const when = (i: AgentItem) => Date.parse(i.resolvedAt || i.createdAt) || 0;
  const posts: AgentPost[] = postRows
    .map((r) => ({
      id: r.id,
      channel: (r.channel === "instagram" || r.channel === "google" ? r.channel : "facebook") as AgentPostChannel,
      day: r.day,
      text: r.text,
      photo: Number(r.photo) || 0,
      status: (r.status === "used" ? "used" : "ready") as AgentPost["status"],
    }))
    .sort((a, z) => (a.status === z.status ? a.day.localeCompare(z.day) : a.status === "ready" ? -1 : 1));
  const lastRunAt = rawAgentRanAt(b);
  const week: AgentNumbers = { views: views7, chats: w.chats, contacts: w.contacts, spendUsd: spend7 };
  const prevWeek: AgentNumbers = { views: Math.max(0, views14 - views7), chats: p.chats, contacts: p.contacts, spendUsd: spendPrev };

  return {
    allowed: limitsFor(user).autoMarketing,
    started: Boolean(lastRunAt) || items.length > 0,
    budgetUsd: b.marketing.profile.monthlyBudgetUsd,
    metaReady: metaReady(),
    metaConnected: Boolean(conn),
    pending: items.filter((i) => i.status === "pending"),
    activity: items
      .filter((i) => i.status !== "pending")
      .sort((a, z) => when(z) - when(a))
      .slice(0, 30),
    posts,
    week,
    prevWeek,
    lastRunAt,
  };
}
