import "server-only";
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { BusinessRow, CampaignMeta, CampaignRow, MetaConnectionRow } from "./db";
import { siteUrl } from "./billing";
import { isOurBlob } from "./site";

// Meta (Facebook / Instagram) ads, through the Graph API directly (no SDK).
// OFF until the founder creates a Meta app and sets, in Vercel:
//   META_APP_ID, META_APP_SECRET, optional META_GRAPH_VERSION (default v23.0)
// Rules: tokens are stored only encrypted and never logged; everything is
// created PAUSED and only turned on when the owner taps "Activar" (or approves
// the marketing agent's launch, which is the same OK to spend).

export const META_STATE_COOKIE = "sevrii_meta_state";
export const META_STATE_MAX_AGE = 10 * 60;
export const META_SCOPES = "ads_management,ads_read,business_management,pages_show_list,pages_read_engagement";

export function metaReady(): boolean {
  return Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET);
}

export function graphVersion(): string {
  const v = (process.env.META_GRAPH_VERSION || "").trim();
  return /^v\d{1,3}\.\d{1,2}$/.test(v) ? v : "v23.0";
}

export function metaRedirectUri(): string {
  return `${siteUrl()}/api/meta/callback`;
}

// ---------- Graph API ----------
export class MetaError extends Error {
  code?: number;
  subcode?: number;
  constructor(message: string, code?: number, subcode?: number) {
    super(message);
    this.name = "MetaError";
    this.code = code;
    this.subcode = subcode;
  }
}

type Params = Record<string, string | number | boolean | object | undefined | null>;

function encodeParams(p: Params): URLSearchParams {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) {
    if (v === undefined || v === null) continue;
    out.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  }
  return out;
}

// Proves the call comes from our server (works whether or not the app has
// "Require app secret" turned on).
function appSecretProof(token: string): string {
  return createHmac("sha256", process.env.META_APP_SECRET || "").update(token).digest("hex");
}

// One Graph API call. GET puts the params in the query string, POST/DELETE
// send them form-encoded. Throws a MetaError carrying Meta's own message;
// the token never appears in errors or logs.
export async function graph<T = Record<string, unknown>>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  params: Params = {},
  token?: string,
  version = graphVersion()
): Promise<T> {
  const all: Params = { ...params };
  if (token) {
    all.access_token = token;
    all.appsecret_proof = appSecretProof(token);
  }
  const body = encodeParams(all);
  const base = `https://graph.facebook.com/${version}/${path.replace(/^\//, "")}`;
  const url = method === "GET" ? `${base}?${body}` : base;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: method === "GET" ? undefined : { "Content-Type": "application/x-www-form-urlencoded" },
      body: method === "GET" ? undefined : body,
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    const timeout = (err as Error)?.name === "TimeoutError" || (err as Error)?.name === "AbortError";
    throw new MetaError(timeout ? "Meta took too long to answer." : "Couldn't reach Meta.");
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  const e = (data as { error?: Record<string, unknown> } | null)?.error;
  if (!res.ok || e) {
    const msg = String(e?.error_user_msg || e?.message || `Meta error ${res.status}`).slice(0, 400);
    throw new MetaError(msg, Number(e?.code) || undefined, Number(e?.error_subcode) || undefined);
  }
  return (data ?? {}) as T;
}

// ---------- Token encryption (AES-256-GCM) ----------
function tokenKey(): Buffer {
  const secret = process.env.SEVRII_TOKEN_KEY || process.env.META_APP_SECRET || "";
  if (!secret) throw new Error("No key to encrypt tokens.");
  return createHmac("sha256", secret).update("sevrii:meta-token:v1").digest();
}

export function encryptToken(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", tokenKey(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1.${Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64url")}`;
}

// null when it can't be read (wrong/rotated key or a damaged value).
export function decryptToken(enc: string): string | null {
  try {
    if (!enc.startsWith("v1.")) return null;
    const raw = Buffer.from(enc.slice(3), "base64url");
    if (raw.length < 29) return null;
    const d = createDecipheriv("aes-256-gcm", tokenKey(), raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

// ---------- OAuth (Facebook Login) ----------
export type MetaState = { state: string; businessId: string };

export function newMetaState(businessId: string): MetaState {
  return { state: randomBytes(24).toString("base64url"), businessId };
}

export function sameState(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

export function metaDialogUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: process.env.META_APP_ID || "",
    redirect_uri: metaRedirectUri(),
    state,
    scope: META_SCOPES,
    response_type: "code",
  });
  return `https://www.facebook.com/${graphVersion()}/dialog/oauth?${p}`;
}

export type MetaLogin = { token: string; expiresAt: string | null; name: string };

// code → short-lived token → long-lived token (about 60 days) → the person's name.
export async function exchangeMetaCode(code: string): Promise<MetaLogin> {
  const app = { client_id: process.env.META_APP_ID || "", client_secret: process.env.META_APP_SECRET || "" };
  const short = await graph<{ access_token?: string }>("GET", "oauth/access_token", {
    ...app,
    redirect_uri: metaRedirectUri(),
    code,
  });
  if (!short.access_token) throw new MetaError("Meta didn't return a token.");
  const long = await graph<{ access_token?: string; expires_in?: number }>("GET", "oauth/access_token", {
    ...app,
    grant_type: "fb_exchange_token",
    fb_exchange_token: short.access_token,
  });
  const token = long.access_token || short.access_token;
  const secs = Number(long.expires_in);
  const expiresAt = Number.isFinite(secs) && secs > 0 ? new Date(Date.now() + secs * 1000).toISOString() : null;
  const me = await graph<{ name?: string }>("GET", "me", { fields: "name" }, token);
  return { token, expiresAt, name: String(me.name || "").slice(0, 120) };
}

// The stored token, or null if missing, unreadable or expired.
export function connectionToken(conn: MetaConnectionRow | null): string | null {
  if (!conn) return null;
  if (conn.expiresAt && new Date(conn.expiresAt).getTime() < Date.now()) return null;
  return decryptToken(conn.tokenEnc);
}

// ---------- Assets ----------
export type AdAccount = { id: string; name: string; currency: string; status: number };
export type FbPage = { id: string; name: string };

export async function listAdAccounts(token: string): Promise<AdAccount[]> {
  const r = await graph<{ data?: Record<string, unknown>[] }>("GET", "me/adaccounts", { fields: "name,account_id,currency,account_status", limit: 100 }, token);
  return (r.data ?? [])
    .map((a) => ({
      id: String(a.account_id || "").replace(/^act_/, ""),
      name: String(a.name || a.account_id || "").slice(0, 120),
      currency: String(a.currency || ""),
      status: Number(a.account_status) || 0,
    }))
    .filter((a) => /^\d+$/.test(a.id));
}

export async function listPages(token: string): Promise<FbPage[]> {
  const r = await graph<{ data?: Record<string, unknown>[] }>("GET", "me/accounts", { fields: "name,id", limit: 100 }, token);
  return (r.data ?? [])
    .map((p) => ({ id: String(p.id || ""), name: String(p.name || p.id || "").slice(0, 120) }))
    .filter((p) => /^\d+$/.test(p.id));
}

// ---------- Launch ----------
const SPECIAL: Record<string, string> = {
  credit: "CREDIT",
  employment: "EMPLOYMENT",
  housing: "HOUSING",
  financial: "FINANCIAL_PRODUCTS_SERVICES",
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// Budget and length, re-checked against the same limits as lib/marketing.ts.
export function campaignMoney(spec: NonNullable<CampaignRow["spec"]>): { dailyCents: number; days: number } {
  const daily = clamp(Number(spec.dailyBudgetUsd) || 10, 1, 10_000);
  const days = Math.round(clamp(Number(spec.durationDays) || 7, 1, 90));
  return { dailyCents: Math.round(daily * 100), days };
}

function unixIn(days: number): number {
  return Math.floor(Date.now() / 1000) + Math.round(days * 86400);
}

// Download our own public photo and upload it to the ad account (image_hash).
async function uploadImage(token: string, act: string, imageUrl: string): Promise<string | null> {
  if (!isOurBlob(imageUrl)) return null;
  try {
    const res = await fetch(imageUrl, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (!res.ok || !/^image\/(jpeg|png|webp|gif)/i.test(res.headers.get("content-type") || "")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > 8 * 1024 * 1024) return null;
    const r = await graph<{ images?: Record<string, { hash?: string }> }>("POST", `${act}/adimages`, { bytes: buf.toString("base64") }, token);
    const first = Object.values(r.images ?? {})[0];
    return first?.hash || null;
  } catch {
    return null;
  }
}

// One ad creative (text + photo + "Learn more" to the page) on the owner's page.
async function createCreative(
  token: string,
  act: string,
  pageId: string,
  ad: { primaryText: string; headline: string; description: string },
  title: string,
  name: string,
  link: string,
  imageUrl?: string | null
): Promise<string> {
  const hash = imageUrl ? await uploadImage(token, act, imageUrl) : null;
  const linkData: Record<string, unknown> = {
    link,
    message: ad.primaryText.slice(0, 600),
    name: (ad.headline || title).slice(0, 80),
    description: ad.description ? ad.description.slice(0, 120) : undefined,
    call_to_action: { type: "LEARN_MORE", value: { link } },
  };
  if (hash) linkData.image_hash = hash;
  else if (imageUrl && isOurBlob(imageUrl)) linkData.picture = imageUrl;
  const cr = await graph<{ id: string }>("POST", `${act}/adcreatives`, {
    name: `${name} · Creative`,
    object_story_spec: { page_id: pageId, link_data: linkData },
  }, token);
  return cr.id;
}

export async function launchCampaign(
  conn: MetaConnectionRow,
  business: BusinessRow,
  campaign: CampaignRow,
  link: string,
  imageUrl?: string | null
): Promise<CampaignMeta> {
  const token = connectionToken(conn);
  if (!token) throw new MetaError("reconnect");
  const spec = campaign.spec;
  if (!spec || spec.platform !== "meta") throw new MetaError("Not a Meta campaign.");
  if (!conn.adAccountId || !conn.pageId) throw new MetaError("Choose an ad account and a page first.");
  const act = `act_${conn.adAccountId}`;

  const acct = await graph<{ currency?: string; account_status?: number }>("GET", act, { fields: "currency,account_status" }, token);
  if (Number(acct.account_status) !== 1) throw new MetaError("account_inactive");
  if (acct.currency && acct.currency !== "USD") throw new MetaError("currency");

  const { dailyCents, days } = campaignMoney(spec);
  const special = SPECIAL[spec.specialCategory] ? [SPECIAL[spec.specialCategory]] : [];
  const ad = spec.ads[0] ?? { primaryText: campaign.adCopy || business.pitch || business.name, headline: campaign.title, description: "" };
  const name = (campaign.title || business.name || "Sevrii").slice(0, 200);

  // Where: around the business when it works in person, otherwise all of the US.
  const site = business.site;
  let geo: Record<string, unknown> = { countries: ["US"] };
  if (site.reachMode === "local" && site.baseLat !== null && site.baseLon !== null) {
    const min = special.length ? 15 : 1;
    const radius = clamp(Math.round(spec.radiusMiles || site.reachRadius || 10), min, 50);
    geo = { custom_locations: [{ latitude: site.baseLat, longitude: site.baseLon, radius, distance_unit: "mile" }] };
  }
  const targeting = {
    geo_locations: geo,
    age_min: special.length ? 18 : clamp(spec.ageMin || 18, 18, 65),
    age_max: special.length ? 65 : clamp(spec.ageMax || 65, 18, 65),
    targeting_automation: { advantage_audience: 0 },
  };

  const created: string[] = [];
  let creativeId = "";
  try {
    const c = await graph<{ id: string }>("POST", `${act}/campaigns`, {
      name,
      objective: "OUTCOME_TRAFFIC",
      status: "PAUSED",
      special_ad_categories: special,
      special_ad_category_country: special.length ? ["US"] : undefined,
      is_adset_budget_sharing_enabled: false,
    }, token);
    created.push(c.id);

    const s = await graph<{ id: string }>("POST", `${act}/adsets`, {
      name: `${name} · Ad set`,
      campaign_id: c.id,
      daily_budget: dailyCents,
      billing_event: "IMPRESSIONS",
      optimization_goal: "LINK_CLICKS",
      bid_strategy: "LOWEST_COST_WITHOUT_CAP",
      destination_type: "WEBSITE",
      targeting,
      start_time: Math.floor(Date.now() / 1000),
      end_time: unixIn(days),
      status: "PAUSED",
    }, token);

    creativeId = await createCreative(token, act, conn.pageId, ad, campaign.title, name, link, imageUrl);

    const a = await graph<{ id: string }>("POST", `${act}/ads`, {
      name: `${name} · Ad`,
      adset_id: s.id,
      creative: { creative_id: creativeId },
      status: "PAUSED",
    }, token);

    return { campaignId: c.id, adSetId: s.id, adId: a.id, status: "paused", launchedAt: new Date().toISOString() };
  } catch (err) {
    // Undo what was made (deleting the campaign removes its ad sets and ads).
    for (const id of [...created, creativeId].filter(Boolean)) {
      await graph("DELETE", id, {}, token).catch(() => {});
    }
    throw err instanceof MetaError ? err : new MetaError("Couldn't create the campaign on Meta.");
  }
}

// ---------- On / off ----------
export async function setStatus(conn: MetaConnectionRow, meta: CampaignMeta, status: "ACTIVE" | "PAUSED", runDays?: number): Promise<void> {
  const token = connectionToken(conn);
  if (!token) throw new MetaError("reconnect");
  if (status === "ACTIVE") {
    // The run starts now, so it lasts the days the owner agreed to.
    if (runDays) await graph("POST", meta.adSetId, { end_time: unixIn(runDays) }, token).catch(() => {});
    // Inside out, so nothing delivers before every piece is on.
    for (const id of [meta.adId, meta.adSetId, meta.campaignId]) await graph("POST", id, { status }, token);
  } else {
    // Outside in: the campaign stops first.
    for (const id of [meta.campaignId, meta.adSetId, meta.adId]) await graph("POST", id, { status }, token);
  }
}

// ---------- Numbers ----------
export type MetaStats = NonNullable<CampaignMeta["stats"]>;

export async function fetchStats(conn: MetaConnectionRow, meta: CampaignMeta): Promise<MetaStats & { review?: string }> {
  const token = connectionToken(conn);
  if (!token) throw new MetaError("reconnect");
  const r = await graph<{ data?: Record<string, unknown>[] }>("GET", `${meta.campaignId}/insights`, { fields: "spend,impressions,clicks", date_preset: "maximum" }, token);
  const row = r.data?.[0] ?? {};
  let review: string | undefined;
  try {
    const a = await graph<{ effective_status?: string }>("GET", meta.adId, { fields: "effective_status" }, token);
    review = a.effective_status;
  } catch {
    review = undefined;
  }
  return {
    spend: Math.round((Number(row.spend) || 0) * 100) / 100,
    impressions: Math.round(Number(row.impressions) || 0),
    clicks: Math.round(Number(row.clicks) || 0),
    at: new Date().toISOString(),
    review,
  };
}

// ---------- Changes the marketing agent makes (never more spend without the owner's OK) ----------

// New daily budget for a live campaign's ad set (only after the owner approves it).
export async function setDailyBudget(conn: MetaConnectionRow, meta: CampaignMeta, dailyUsd: number): Promise<void> {
  const token = connectionToken(conn);
  if (!token) throw new MetaError("reconnect");
  if (!meta.adSetId) throw new MetaError("Not on Meta.");
  const cents = Math.round(clamp(Number(dailyUsd) || 1, 1, 10_000) * 100);
  await graph("POST", meta.adSetId, { daily_budget: cents }, token);
}

// Swap the text of a live ad for a new variation (same budget, same audience).
// Meta reviews the ad again before it shows the new text.
export async function replaceAdCreative(
  conn: MetaConnectionRow,
  campaign: CampaignRow,
  meta: CampaignMeta,
  link: string,
  imageUrl?: string | null
): Promise<void> {
  const token = connectionToken(conn);
  if (!token) throw new MetaError("reconnect");
  const ad = campaign.spec?.ads[0];
  if (!ad || !meta.adId || !conn.adAccountId || !conn.pageId) throw new MetaError("Not on Meta.");
  const act = `act_${conn.adAccountId}`;
  const name = (campaign.title || "Sevrii").slice(0, 200);
  const creativeId = await createCreative(token, act, conn.pageId, ad, campaign.title, name, link, imageUrl);
  try {
    await graph("POST", meta.adId, { creative: { creative_id: creativeId } }, token);
  } catch (err) {
    await graph("DELETE", creativeId, {}, token).catch(() => {});
    throw err;
  }
}

// What a campaign spent between two days (YYYY-MM-DD, both included, ad account time).
export async function fetchSpend(conn: MetaConnectionRow, meta: CampaignMeta, since: string, until: string): Promise<number> {
  const token = connectionToken(conn);
  if (!token) throw new MetaError("reconnect");
  const r = await graph<{ data?: Record<string, unknown>[] }>("GET", `${meta.campaignId}/insights`, { fields: "spend", time_range: { since, until } }, token);
  return Math.round((r.data ?? []).reduce((sum, row) => sum + (Number(row.spend) || 0), 0) * 100) / 100;
}
