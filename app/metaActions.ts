"use server";

import { getCurrentUser } from "@/lib/session";
import { limitsFor, siteUrl } from "@/lib/billing";
import { deleteMetaConnection, getMetaConnection, listCampaigns, setCampaignMeta, setMetaAssets, type CampaignMeta, type CampaignRow } from "@/lib/db";
import { allow, clear } from "@/lib/guard";
import { getLang } from "@/lib/lang";
import { maxDailySpend } from "@/lib/marketing";
import { isOurBlob } from "@/lib/site";
import { campaignMoney, connectionToken, fetchStats, launchCampaign, listAdAccounts, listPages, MetaError, metaReady, setStatus } from "@/lib/meta";

// Owner-only actions for publishing Marketing campaigns on Facebook/Instagram.
// Everything is created PAUSED; money only moves after the owner taps "Activar".

export type MetaStatus = {
  ready: boolean;
  connected: boolean;
  expired?: boolean;
  fbUserName: string;
  adAccount: { id: string; name: string } | null;
  page: { id: string; name: string } | null;
  adAccounts?: { id: string; name: string; currency: string; active: boolean }[];
  pages?: { id: string; name: string }[];
};

export type MetaCampaignInfo = {
  ready: boolean;
  connected: boolean;
  meta: CampaignMeta | null;
  dailyBudgetUsd: number;
  maxDailyUsd: number;
  durationDays: number;
};

export type MetaResult = { meta: CampaignMeta } | { error: string };

const TEXT = {
  es: {
    off: "La publicación en Facebook todavía no está disponible.",
    signin: "Vuelve a iniciar sesión.",
    plan: "Conectar Facebook para publicar es parte del plan Pro.",
    notConnected: "Primero conecta tu cuenta de Facebook.",
    reconnect: "La conexión con Facebook venció. Desconecta y vuelve a conectar.",
    noAssets: "Elige tu cuenta publicitaria y tu página de Facebook.",
    badAssets: "Esa cuenta o página no está en tu Facebook.",
    notFound: "No encontramos esa campaña.",
    notMeta: "Esta campaña no es para Facebook o Instagram.",
    notLive: "Publica tu página primero: el anuncio lleva a la gente ahí.",
    already: "Esta campaña ya está creada en Facebook.",
    notLaunched: "Esta campaña todavía no está en Facebook.",
    busy: "Espera un momento e inténtalo de nuevo.",
    inactive: "Tu cuenta publicitaria no está activa. Revísala en el Administrador de anuncios de Meta.",
    currency: "Tu cuenta publicitaria no usa dólares (USD). Usa una cuenta en USD.",
    meta: (m: string) => `Facebook respondió: ${m}`,
    failed: "No se pudo completar. Inténtalo de nuevo.",
    review: "Facebook rechazó o marcó un problema con el anuncio. Revísalo en el Administrador de anuncios.",
  },
  en: {
    off: "Publishing on Facebook isn't available yet.",
    signin: "Please sign in again.",
    plan: "Connecting Facebook to publish is part of the Pro plan.",
    notConnected: "Connect your Facebook account first.",
    reconnect: "The Facebook connection expired. Disconnect and connect again.",
    noAssets: "Choose your ad account and your Facebook page.",
    badAssets: "That account or page isn't on your Facebook.",
    notFound: "We couldn't find that campaign.",
    notMeta: "This campaign isn't for Facebook or Instagram.",
    notLive: "Publish your page first: the ad sends people there.",
    already: "This campaign is already on Facebook.",
    notLaunched: "This campaign isn't on Facebook yet.",
    busy: "Wait a moment and try again.",
    inactive: "Your ad account isn't active. Check it in Meta Ads Manager.",
    currency: "Your ad account doesn't use US dollars (USD). Use a USD account.",
    meta: (m: string) => `Facebook said: ${m}`,
    failed: "Couldn't finish. Try again.",
    review: "Facebook rejected or flagged the ad. Check it in Ads Manager.",
  },
};
type T = (typeof TEXT)["es"];

function friendly(err: unknown, t: T): string {
  if (err instanceof MetaError) {
    if (err.message === "reconnect" || err.code === 190) return t.reconnect;
    if (err.message === "account_inactive") return t.inactive;
    if (err.message === "currency") return t.currency;
    return t.meta(err.message);
  }
  return t.failed;
}

type Ctx =
  | { t: T; error: string }
  | { t: T; error?: undefined; user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>; business: NonNullable<NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>["business"]>; conn: Awaited<ReturnType<typeof getMetaConnection>> };

// The signed-in owner, their business and its Meta connection.
async function context(): Promise<Ctx> {
  const lang = await getLang();
  const t = TEXT[lang];
  const user = await getCurrentUser();
  if (!user || !user.business) return { t, error: t.signin };
  if (!metaReady()) return { t, error: t.off };
  if (!limitsFor(user).autoMarketing) return { t, error: t.plan };
  const business = user.business;
  const conn = await getMetaConnection(business.id);
  return { t, user, business, conn };
}

async function findCampaign(businessId: string, campaignId: string): Promise<CampaignRow | null> {
  if (typeof campaignId !== "string" || campaignId.length > 64) return null;
  return (await listCampaigns(businessId)).find((c) => c.id === campaignId) ?? null;
}

export async function getMetaStatusAction(): Promise<MetaStatus> {
  const empty: MetaStatus = { ready: metaReady(), connected: false, fbUserName: "", adAccount: null, page: null };
  const ctx = await context();
  if (ctx.error !== undefined) return empty;
  const { conn } = ctx;
  if (!conn) return empty;
  const token = connectionToken(conn);
  const base: MetaStatus = {
    ...empty,
    connected: true,
    expired: !token,
    fbUserName: conn.fbUserName,
    adAccount: conn.adAccountId ? { id: conn.adAccountId, name: conn.adAccountName } : null,
    page: conn.pageId ? { id: conn.pageId, name: conn.pageName } : null,
  };
  if (!token || (base.adAccount && base.page)) return base;
  try {
    const [accounts, pages] = await Promise.all([listAdAccounts(token), listPages(token)]);
    return {
      ...base,
      adAccounts: accounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency, active: a.status === 1 })),
      pages,
    };
  } catch (err) {
    if (err instanceof MetaError && err.code === 190) return { ...base, expired: true };
    return { ...base, adAccounts: [], pages: [] };
  }
}

export async function chooseMetaAssetsAction(adAccountId: string, pageId: string): Promise<{ ok: true } | { error: string }> {
  const ctx = await context();
  if (ctx.error !== undefined) return { error: ctx.error };
  const { t, business, conn } = ctx;
  const token = connectionToken(conn);
  if (!conn) return { error: t.notConnected };
  if (!token) return { error: t.reconnect };
  try {
    const [accounts, pages] = await Promise.all([listAdAccounts(token), listPages(token)]);
    const acct = accounts.find((a) => a.id === String(adAccountId || "").replace(/^act_/, ""));
    const page = pages.find((p) => p.id === String(pageId || ""));
    if (!acct || !page) return { error: t.badAssets };
    await setMetaAssets(business.id, { adAccountId: acct.id, adAccountName: acct.name, pageId: page.id, pageName: page.name });
    return { ok: true };
  } catch (err) {
    return { error: friendly(err, t) };
  }
}

export async function disconnectMetaAction(): Promise<{ ok: true } | { error: string }> {
  const t = TEXT[await getLang()];
  const user = await getCurrentUser();
  if (!user || !user.business) return { error: t.signin };
  // Campaigns already on Meta stay there (the owner manages them in Ads Manager).
  await deleteMetaConnection(user.business.id);
  return { ok: true };
}

// What MetaLaunch needs for one campaign (state + the money shown before Activar).
export async function getMetaCampaignAction(campaignId: string): Promise<MetaCampaignInfo | null> {
  const ctx = await context();
  if (ctx.error !== undefined) return null;
  const campaign = await findCampaign(ctx.business.id, campaignId);
  if (!campaign?.spec) return null;
  const { dailyCents, days } = campaignMoney(campaign.spec);
  const daily = dailyCents / 100;
  return {
    ready: true,
    connected: Boolean(ctx.conn && ctx.conn.adAccountId && ctx.conn.pageId),
    meta: campaign.meta ?? null,
    dailyBudgetUsd: daily,
    maxDailyUsd: maxDailySpend(daily),
    durationDays: days,
  };
}

export async function launchCampaignOnMetaAction(campaignId: string): Promise<MetaResult> {
  const ctx = await context();
  if (ctx.error !== undefined) return { error: ctx.error };
  const { t, user, business, conn } = ctx;
  if (!conn) return { error: t.notConnected };
  if (!connectionToken(conn)) return { error: t.reconnect };
  if (!conn.adAccountId || !conn.pageId) return { error: t.noAssets };
  const campaign = await findCampaign(business.id, campaignId);
  if (!campaign) return { error: t.notFound };
  if (campaign.spec?.platform !== "meta") return { error: t.notMeta };
  if (campaign.meta?.campaignId) return { error: t.already };
  if (!business.published || !limitsFor(user).canPublish) return { error: t.notLive };

  // One launch at a time per campaign (a double tap must not create two).
  const key = `meta:launch:${business.id}:${campaign.id}`;
  if (!(await allow(key, 1, 120))) return { error: t.busy };
  if (!(await allow(`meta:launch:${business.id}`, 10, 60 * 60))) return { error: t.busy };

  const link = `${siteUrl()}/site/${business.slug}?c=${encodeURIComponent(campaign.id)}`;
  // A public photo of the business (the ad-image route is owner-only, so Meta can't fetch it).
  const image = [business.site.coverUrl, ...business.site.gallery].find((u) => u && isOurBlob(u)) || null;
  try {
    const meta = await launchCampaign(conn, business, campaign, link, image);
    await setCampaignMeta(business.id, campaign.id, meta);
    return { meta };
  } catch (err) {
    await clear(key);
    const error = friendly(err, t);
    const meta: CampaignMeta = { campaignId: "", adSetId: "", adId: "", status: "error", error, launchedAt: new Date().toISOString() };
    await setCampaignMeta(business.id, campaign.id, meta);
    return { error };
  }
}

// Only called when the owner taps Activar (after confirming) or Pausar.
export async function setCampaignMetaStatusAction(campaignId: string, status: "active" | "paused"): Promise<MetaResult> {
  const ctx = await context();
  if (ctx.error !== undefined) return { error: ctx.error };
  const { t, business, conn } = ctx;
  if (status !== "active" && status !== "paused") return { error: t.failed };
  if (!conn) return { error: t.notConnected };
  const campaign = await findCampaign(business.id, campaignId);
  if (!campaign) return { error: t.notFound };
  const meta = campaign.meta;
  if (!meta?.campaignId || !meta.adSetId || !meta.adId) return { error: t.notLaunched };
  if (!(await allow(`meta:status:${business.id}`, 10, 10 * 60))) return { error: t.busy };
  try {
    const days = status === "active" && campaign.spec ? campaignMoney(campaign.spec).days : undefined;
    await setStatus(conn, meta, status === "active" ? "ACTIVE" : "PAUSED", days);
    const next: CampaignMeta = { ...meta, status, error: undefined };
    await setCampaignMeta(business.id, campaign.id, next);
    return { meta: next };
  } catch (err) {
    return { error: friendly(err, t) };
  }
}

export async function refreshCampaignStatsAction(campaignId: string): Promise<MetaResult> {
  const ctx = await context();
  if (ctx.error !== undefined) return { error: ctx.error };
  const { t, business, conn } = ctx;
  if (!conn) return { error: t.notConnected };
  const campaign = await findCampaign(business.id, campaignId);
  if (!campaign) return { error: t.notFound };
  const meta = campaign.meta;
  if (!meta?.campaignId) return { error: t.notLaunched };
  if (!(await allow(`meta:stats:${business.id}`, 20, 10 * 60))) return { error: t.busy };
  try {
    const { review, ...stats } = await fetchStats(conn, meta);
    const flagged = review === "DISAPPROVED" || review === "WITH_ISSUES";
    const next: CampaignMeta = { ...meta, stats, error: flagged ? t.review : undefined };
    await setCampaignMeta(business.id, campaign.id, next);
    return { meta: next };
  } catch (err) {
    return { error: friendly(err, t) };
  }
}
