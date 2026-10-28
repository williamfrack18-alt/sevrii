import "server-only";
// Marketing videos: the marketing chat plans them (angle, prompt, tool), the
// cloud browser makes them in an AI video tool (lib/marketingVideoJob.ts), and
// each one runs on Meta as its own video ad — created ONLY through the
// Marketing API in the owner's own ad account and page (Meta charges the
// owner's card). Every step that publishes or spends is a proposal the owner
// approves in the chat ("dale" or the button); one OK runs exactly one action.

import {
  campaignStats,
  claimMarketingAction,
  finishMarketingAction,
  getMarketingVideo,
  getMetaConnection,
  listMarketingVideos,
  updateMarketingVideo,
  type BusinessRow,
  type MarketingActionRow,
  type MarketingVideoRow,
  type MetaConnectionRow,
} from "./db";
import { connectionToken, graph, MetaError, metaReady, stateRegionKey } from "./meta";
import { campaignLink } from "./campaignLink";
import { siteUrl } from "./billing";
import type { Lang } from "./i18n";

// AI video tools the agent may use (official sites). Login is always the owner's, in the live view.
export const VIDEO_TOOLS: Record<string, { name: string; url: string; hosts: string[] }> = {
  flow: { name: "Google Flow (Veo)", url: "https://labs.google/fx/tools/flow", hosts: ["labs.google", "accounts.google.com", "google.com", "googleusercontent.com", "gstatic.com"] },
  kling: { name: "Kling AI", url: "https://app.klingai.com", hosts: ["klingai.com", "kling.ai"] },
  runway: { name: "Runway", url: "https://app.runwayml.com", hosts: ["runwayml.com"] },
  hailuo: { name: "Hailuo AI", url: "https://hailuoai.video", hosts: ["hailuoai.video", "minimax.io", "hailuoai.com"] },
};
export const DEFAULT_VIDEO_TOOL = "flow";
export const videoToolOf = (key: string) => VIDEO_TOOLS[key] ?? VIDEO_TOOLS[DEFAULT_VIDEO_TOOL];

export const videoToken = (id: string) => `[[mkvideo:${id}]]`;
export const actionToken = (id: string) => `[[mkok:${id}]]`;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const usd = (n: number) => `$${(Math.round(n * 100) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const SPECIAL: Record<string, string> = { credit: "FINANCIAL_PRODUCTS_SERVICES", financial: "FINANCIAL_PRODUCTS_SERVICES", employment: "EMPLOYMENT", housing: "HOUSING" };

function usable(conn: MetaConnectionRow | null): { conn: MetaConnectionRow; token: string } | null {
  if (!metaReady() || !conn || !conn.adAccountId || !conn.pageId) return null;
  const token = connectionToken(conn);
  return token ? { conn, token } : null;
}

// ---------- the exact words of each proposal (what, where, how much) ----------
export type ActionKind = "make_video" | "launch_video" | "pause_video" | "resume_video" | "set_budget" | "move_budget";
export const ACTION_KINDS: ActionKind[] = ["make_video", "launch_video", "pause_video", "resume_video", "set_budget", "move_budget"];

export function actionSummary(kind: ActionKind, p: Record<string, unknown>, videos: MarketingVideoRow[], conn: MetaConnectionRow | null, lang: Lang): string | { error: string } {
  const es = lang === "es";
  const v = videos.find((x) => x.id === p.videoId);
  const to = videos.find((x) => x.id === p.toVideoId);
  const q = (s: string) => (es ? `«${s}»` : `“${s}”`);
  const where = conn?.pageName ? (es ? ` en la página ${conn.pageName}` : ` on the page ${conn.pageName}`) : "";
  if (!v) return { error: "unknown videoId" };
  switch (kind) {
    case "make_video": {
      if (!["planned", "failed"].includes(v.status)) return { error: `video status is ${v.status}: only planned or failed videos can be made` };
      const tool = videoToolOf(v.tool).name;
      return es
        ? `Crear el video ${q(v.title)} en ${tool} con el ángulo: ${v.angle}. Usa los créditos o el plan de tu cuenta de ${tool}; si pide iniciar sesión o pagar, lo haces tú en la vista en vivo.`
        : `Make the video ${q(v.title)} in ${tool} with the angle: ${v.angle}. It uses the credits or plan of your ${tool} account; if it asks you to sign in or pay, you do it in the live view.`;
    }
    case "launch_video": {
      if (v.status !== "ready") return { error: `video status is ${v.status}: only a ready video can be published` };
      const daily = clamp(Number(p.dailyUsd) || 0, 1, 1000);
      const days = Math.round(clamp(Number(p.days) || 0, 1, 90));
      if (!Number(p.dailyUsd) || !Number(p.days)) return { error: "dailyUsd and days are required" };
      return es
        ? `Publicar ${q(v.title)} como anuncio de video en Facebook e Instagram${where}: ${usd(daily)} al día por ${days} días (hasta ${usd(daily * days)} en total; Meta cobra a tu tarjeta y un día puede gastar hasta ${usd(daily * 1.75)}).`
        : `Publish ${q(v.title)} as a video ad on Facebook and Instagram${where}: ${usd(daily)} a day for ${days} days (up to ${usd(daily * days)} in total; Meta charges your card and one day may spend up to ${usd(daily * 1.75)}).`;
    }
    case "pause_video":
      if (v.status !== "active") return { error: "only an active video ad can be paused" };
      return es ? `Pausar el anuncio de ${q(v.title)} en Facebook e Instagram (deja de gastar).` : `Pause the ad for ${q(v.title)} on Facebook and Instagram (it stops spending).`;
    case "resume_video":
      if (v.status !== "paused") return { error: "only a paused video ad can be resumed" };
      return es
        ? `Volver a activar el anuncio de ${q(v.title)}: vuelve a gastar ${usd(Number(v.meta.dailyUsd) || 0)} al día.`
        : `Turn the ad for ${q(v.title)} back on: it spends ${usd(Number(v.meta.dailyUsd) || 0)} a day again.`;
    case "set_budget": {
      if (!["active", "paused"].includes(v.status)) return { error: "the video must be on Meta (active or paused)" };
      const daily = clamp(Number(p.dailyUsd) || 0, 1, 1000);
      if (!Number(p.dailyUsd)) return { error: "dailyUsd is required" };
      return es
        ? `Cambiar el presupuesto de ${q(v.title)} de ${usd(Number(v.meta.dailyUsd) || 0)} a ${usd(daily)} al día.`
        : `Change the budget of ${q(v.title)} from ${usd(Number(v.meta.dailyUsd) || 0)} to ${usd(daily)} a day.`;
    }
    case "move_budget": {
      if (!to) return { error: "unknown toVideoId" };
      if (!["active", "paused"].includes(v.status) || !["active", "paused"].includes(to.status)) return { error: "both videos must be on Meta" };
      const amount = Number(p.usd) || 0;
      const from = Number(v.meta.dailyUsd) || 0;
      if (amount <= 0 || from - amount < 1) return { error: `usd must be > 0 and leave at least $1/day (the first one has ${usd(from)}/day)` };
      return es
        ? `Mover ${usd(amount)} al día de ${q(v.title)} (queda en ${usd(from - amount)}) a ${q(to.title)} (sube a ${usd((Number(to.meta.dailyUsd) || 0) + amount)}). El total al día no cambia.`
        : `Move ${usd(amount)} a day from ${q(v.title)} (down to ${usd(from - amount)}) to ${q(to.title)} (up to ${usd((Number(to.meta.dailyUsd) || 0) + amount)}). The daily total doesn't change.`;
    }
  }
}

// ---------- Meta: video ads through the Marketing API ----------
async function targetingFor(b: BusinessRow, token: string, special: string[]) {
  const site = b.site;
  let geo: Record<string, unknown> = { countries: ["US"] };
  if (site.reachMode === "local" && site.baseLat !== null && site.baseLon !== null) {
    const radius = clamp(Math.round(site.reachRadius || 10), special.length ? 15 : 1, 50);
    geo = { custom_locations: [{ latitude: site.baseLat, longitude: site.baseLon, radius, distance_unit: "mile" }] };
  } else if (site.reachMode === "remote" && site.reachScope === "state" && site.baseState) {
    const key = await stateRegionKey(site.baseState, token);
    if (key) geo = { regions: [{ key }] };
  }
  return { geo_locations: geo, age_min: 18, age_max: 65, targeting_automation: { advantage_audience: 0 } };
}

const unixIn = (days: number) => Math.floor(Date.now() / 1000) + Math.round(days * 86400);

// Starts the launch: the video goes to the ad account; the rest follows when Meta finishes processing it.
async function startLaunch(b: BusinessRow, v: MarketingVideoRow, dailyUsd: number, days: number, lang: Lang): Promise<string> {
  const es = lang === "es";
  const m = usable(await getMetaConnection(b.id));
  if (!m) return es ? "No pude publicarlo: conecta tu Facebook y elige tu cuenta publicitaria y tu página en Marketing." : "I couldn't publish it: connect your Facebook and choose your ad account and page in Marketing.";
  if (!v.videoUrl) return es ? "Ese video todavía no tiene archivo." : "That video has no file yet.";
  const act = `act_${m.conn.adAccountId}`;
  const acct = await graph<{ currency?: string; account_status?: number }>("GET", act, { fields: "currency,account_status" }, m.token);
  if (Number(acct.account_status) !== 1) return es ? "Tu cuenta publicitaria de Meta no está activa. Revísala en Meta y vuelve a intentarlo." : "Your Meta ad account isn't active. Check it in Meta and try again.";
  if (acct.currency && acct.currency !== "USD") return es ? "Tu cuenta publicitaria no está en dólares (USD)." : "Your ad account isn't in US dollars.";
  const up = await graph<{ id: string }>("POST", `${act}/advideos`, { file_url: v.videoUrl, name: v.title.slice(0, 100) }, m.token);
  await updateMarketingVideo(b.id, v.id, { status: "launching", meta: { ...v.meta, videoId: up.id, error: undefined, pendingLaunch: { dailyUsd, days, at: new Date().toISOString() } } });
  // Small videos are usually ready in seconds: try to finish right away.
  for (let i = 0; i < 6; i++) {
    await new Promise((ok) => setTimeout(ok, 5000));
    const done = await continueLaunch(b, v.id, lang);
    if (done) return done;
  }
  return es
    ? `Subí ${v.title} a tu cuenta de Meta; Meta lo está procesando. Lo publico en cuanto esté listo (lo ves en Mis videos).`
    : `I uploaded ${v.title} to your Meta account; Meta is processing it. I'll publish it as soon as it's ready (see My videos).`;
}

// Finishes a launch once Meta processed the video. Returns the message, or "" if it's still processing.
export async function continueLaunch(b: BusinessRow, id: string, lang: Lang): Promise<string> {
  const es = lang === "es";
  const v = await getMarketingVideo(b.id, id);
  const pend = v?.meta.pendingLaunch;
  if (!v || v.status !== "launching" || !pend || !v.meta.videoId) return "";
  const m = usable(await getMetaConnection(b.id));
  if (!m) return "";
  const vid = await graph<{ status?: { video_status?: string } }>("GET", v.meta.videoId, { fields: "status" }, m.token).catch(() => null);
  const st = vid?.status?.video_status;
  if (st === "error") {
    await updateMarketingVideo(b.id, id, { status: "ready", meta: { ...v.meta, pendingLaunch: null, error: "Meta couldn't process the video" } });
    return es ? `Meta no pudo procesar ${v.title}. No se publicó nada ni se gastó nada.` : `Meta couldn't process ${v.title}. Nothing was published or spent.`;
  }
  if (st !== "ready") return "";
  const thumbs = await graph<{ data?: { uri?: string; is_preferred?: boolean }[] }>("GET", `${v.meta.videoId}/thumbnails`, { fields: "uri,is_preferred" }, m.token).catch(() => ({ data: [] }));
  const thumb = (thumbs.data ?? []).find((t) => t.is_preferred)?.uri || thumbs.data?.[0]?.uri || "";
  const act = `act_${m.conn.adAccountId}`;
  const special = SPECIAL[String(v.ad.specialCategory || "")] ? [SPECIAL[String(v.ad.specialCategory)]] : [];
  const link = campaignLink(b.slug, v.id, siteUrl());
  const created: string[] = [];
  try {
    // One "Videos" campaign per business, reused while any video still runs on it.
    const others = (await listMarketingVideos(b.id)).filter((x) => x.id !== v.id && x.meta.campaignId && ["active", "paused"].includes(x.status));
    let campaignId = others[0]?.meta.campaignId || "";
    if (!campaignId) {
      const c = await graph<{ id: string }>("POST", `${act}/campaigns`, {
        name: `${b.name} · Videos`.slice(0, 200),
        objective: "OUTCOME_TRAFFIC",
        status: "PAUSED",
        special_ad_categories: special,
        special_ad_category_country: special.length ? ["US"] : undefined,
        is_adset_budget_sharing_enabled: false,
      }, m.token);
      campaignId = c.id;
      created.push(c.id);
    }
    const s = await graph<{ id: string }>("POST", `${act}/adsets`, {
      name: `${v.title} · Video`.slice(0, 200),
      campaign_id: campaignId,
      daily_budget: Math.round(pend.dailyUsd * 100),
      billing_event: "IMPRESSIONS",
      optimization_goal: "LINK_CLICKS",
      bid_strategy: "LOWEST_COST_WITHOUT_CAP",
      destination_type: "WEBSITE",
      targeting: await targetingFor(b, m.token, special),
      start_time: Math.floor(Date.now() / 1000),
      end_time: unixIn(pend.days),
      status: "PAUSED",
    }, m.token);
    created.push(s.id);
    const ad = { message: (v.ad.primaryText || b.pitch || b.name).slice(0, 600), title: (v.ad.headline || v.title).slice(0, 80) };
    const cr = await graph<{ id: string }>("POST", `${act}/adcreatives`, {
      name: `${v.title} · Creative`.slice(0, 200),
      object_story_spec: {
        page_id: m.conn.pageId,
        video_data: { video_id: v.meta.videoId, image_url: thumb || undefined, message: ad.message, title: ad.title, call_to_action: { type: "LEARN_MORE", value: { link } } },
      },
    }, m.token);
    created.push(cr.id);
    const a = await graph<{ id: string }>("POST", `${act}/ads`, { name: `${v.title} · Ad`.slice(0, 200), adset_id: s.id, creative: { creative_id: cr.id }, status: "PAUSED" }, m.token);
    created.push(a.id);
    // On, inside out (the owner's OK covered publishing it with this budget).
    for (const x of [a.id, s.id, campaignId]) await graph("POST", x, { status: "ACTIVE" }, m.token);
    await updateMarketingVideo(b.id, id, {
      status: "active",
      meta: { ...v.meta, campaignId, adSetId: s.id, adId: a.id, dailyUsd: pend.dailyUsd, days: pend.days, launchedAt: new Date().toISOString(), endsAt: new Date(Date.now() + pend.days * 86400000).toISOString(), pendingLaunch: null, error: undefined },
    });
    return es
      ? `Listo: ${v.title} ya está en Facebook e Instagram con ${usd(pend.dailyUsd)} al día por ${pend.days} días. Meta lo revisa antes de mostrarlo; sus números aparecen en Mis videos.`
      : `Done: ${v.title} is on Facebook and Instagram with ${usd(pend.dailyUsd)} a day for ${pend.days} days. Meta reviews it before showing it; its numbers show up in My videos.`;
  } catch (err) {
    for (const x of created.reverse()) await graph("DELETE", x, {}, m.token).catch(() => {});
    const msg = err instanceof MetaError ? err.message : "error";
    await updateMarketingVideo(b.id, id, { status: "ready", meta: { ...v.meta, pendingLaunch: null, error: msg.slice(0, 200) } });
    return es ? `Meta no aceptó el anuncio de ${v.title} (${msg}). No se publicó nada ni se gastó nada.` : `Meta didn't accept the ad for ${v.title} (${msg}). Nothing was published or spent.`;
  }
}

async function setVideoOn(b: BusinessRow, v: MarketingVideoRow, on: boolean): Promise<void> {
  const m = usable(await getMetaConnection(b.id));
  if (!m || !v.meta.adId || !v.meta.adSetId) throw new MetaError("reconnect");
  const status = on ? "ACTIVE" : "PAUSED";
  // Only this video's ad set and ad: the other videos keep running.
  for (const x of on ? [v.meta.adId, v.meta.adSetId] : [v.meta.adSetId, v.meta.adId]) await graph("POST", x, { status }, m.token);
  if (on && v.meta.campaignId) await graph("POST", v.meta.campaignId, { status: "ACTIVE" }, m.token).catch(() => {});
}

async function setVideoBudget(b: BusinessRow, v: MarketingVideoRow, daily: number): Promise<void> {
  const m = usable(await getMetaConnection(b.id));
  if (!m || !v.meta.adSetId) throw new MetaError("reconnect");
  await graph("POST", v.meta.adSetId, { daily_budget: Math.round(clamp(daily, 1, 1000) * 100) }, m.token);
}

// ---------- running an approved action (exactly once) ----------
export async function runMarketingAction(b: BusinessRow, action: MarketingActionRow, lang: Lang): Promise<string> {
  const es = lang === "es";
  const claimed = await claimMarketingAction(b.id, action.id);
  if (!claimed) return es ? "Esa propuesta ya no está vigente (pasaron más de 30 minutos o ya se hizo). Pídemela de nuevo si la quieres." : "That proposal is no longer open (over 30 minutes passed or it was already done). Ask me again if you want it.";
  const p = claimed.params;
  const v = await getMarketingVideo(b.id, String(p.videoId || ""));
  let msg = "";
  try {
    if (!v) throw new Error("unknown video");
    switch (claimed.kind as ActionKind) {
      case "make_video":
        await updateMarketingVideo(b.id, v.id, { status: "making", job: { state: "working", okAt: new Date().toISOString(), memo: [], steps: [], browser: v.job.browser ?? {} } });
        msg = es
          ? `Empecé a crear ${v.title} en ${videoToolOf(v.tool).name}. Lo sigues en Mis videos; si pide que inicies sesión o un pago, te lo muestro en la vista en vivo.\n\n${videoToken(v.id)}`
          : `I started making ${v.title} in ${videoToolOf(v.tool).name}. Follow it in My videos; if it asks you to sign in or pay, I'll show you the live view.\n\n${videoToken(v.id)}`;
        break;
      case "launch_video":
        msg = await startLaunch(b, v, clamp(Number(p.dailyUsd) || 1, 1, 1000), Math.round(clamp(Number(p.days) || 7, 1, 90)), lang);
        msg = `${msg}\n\n${videoToken(v.id)}`;
        break;
      case "pause_video":
        await setVideoOn(b, v, false);
        await updateMarketingVideo(b.id, v.id, { status: "paused" });
        msg = es ? `Pausé el anuncio de ${v.title}. Ya no gasta.` : `I paused the ad for ${v.title}. It no longer spends.`;
        break;
      case "resume_video":
        await setVideoOn(b, v, true);
        await updateMarketingVideo(b.id, v.id, { status: "active" });
        msg = es ? `Volví a activar el anuncio de ${v.title}.` : `I turned the ad for ${v.title} back on.`;
        break;
      case "set_budget": {
        const d = clamp(Number(p.dailyUsd) || 1, 1, 1000);
        await setVideoBudget(b, v, d);
        await updateMarketingVideo(b.id, v.id, { meta: { ...v.meta, dailyUsd: d } });
        msg = es ? `Listo: ${v.title} ahora tiene ${usd(d)} al día.` : `Done: ${v.title} now has ${usd(d)} a day.`;
        break;
      }
      case "move_budget": {
        const to = await getMarketingVideo(b.id, String(p.toVideoId || ""));
        if (!to) throw new Error("unknown video");
        const amount = Number(p.usd) || 0;
        const from = (Number(v.meta.dailyUsd) || 0) - amount;
        const up = (Number(to.meta.dailyUsd) || 0) + amount;
        // Lower first, then raise: the daily total never goes above what was approved.
        await setVideoBudget(b, v, from);
        await updateMarketingVideo(b.id, v.id, { meta: { ...v.meta, dailyUsd: from } });
        await setVideoBudget(b, to, up);
        await updateMarketingVideo(b.id, to.id, { meta: { ...to.meta, dailyUsd: up } });
        msg = es ? `Listo: moví ${usd(amount)} al día de ${v.title} a ${to.title}.` : `Done: I moved ${usd(amount)} a day from ${v.title} to ${to.title}.`;
        break;
      }
      default:
        throw new Error("unknown action");
    }
    await finishMarketingAction(b.id, claimed.id, "done", msg);
  } catch (err) {
    const why = err instanceof MetaError ? (err.message === "reconnect" ? (es ? "hay que volver a conectar tu Facebook" : "your Facebook needs to be reconnected") : err.message) : es ? "no se pudo" : "it couldn't be done";
    msg = es ? `No pude hacerlo: ${why}. No se gastó nada nuevo.` : `I couldn't do it: ${why}. Nothing new was spent.`;
    await finishMarketingAction(b.id, claimed.id, "failed", msg);
  }
  return msg;
}

// ---------- numbers (read through the same API) ----------
export async function refreshVideoStats(b: BusinessRow, force = false): Promise<MarketingVideoRow[]> {
  const videos = await listMarketingVideos(b.id);
  const onMeta = videos.filter((v) => v.meta.adId && ["active", "paused", "ended"].includes(v.status));
  const stale = (v: MarketingVideoRow) => force || !v.stats.at || Date.now() - Date.parse(v.stats.at) > 10 * 60 * 1000;
  if (!onMeta.some(stale)) return videos;
  const m = usable(await getMetaConnection(b.id));
  const chats = await campaignStats(b.id).catch(() => ({}) as Record<string, { chats: number }>);
  for (const v of onMeta.filter(stale)) {
    let next: Partial<MarketingVideoRow> = { stats: { ...v.stats, chats: chats[v.id]?.chats ?? v.stats.chats ?? 0, at: new Date().toISOString() } };
    if (m) {
      try {
        const r = await graph<{ data?: Record<string, unknown>[] }>("GET", `${v.meta.adId}/insights`, { fields: "spend,impressions,clicks,actions", date_preset: "maximum" }, m.token);
        const row = r.data?.[0] ?? {};
        const actions = (row.actions as { action_type?: string; value?: string }[] | undefined) ?? [];
        const views = Number(actions.find((a) => a.action_type === "video_view")?.value) || 0;
        next = {
          stats: {
            views,
            impressions: Math.round(Number(row.impressions) || 0),
            clicks: Math.round(Number(row.clicks) || 0),
            spend: Math.round((Number(row.spend) || 0) * 100) / 100,
            chats: chats[v.id]?.chats ?? 0,
            at: new Date().toISOString(),
          },
        };
        const eff = await graph<{ effective_status?: string }>("GET", String(v.meta.adId), { fields: "effective_status" }, m.token).catch(() => null);
        const ended = v.meta.endsAt && Date.parse(v.meta.endsAt) < Date.now();
        if (ended) next.status = "ended";
        else if (eff?.effective_status && /PAUSED/.test(eff.effective_status) && v.status === "active") next.status = "paused";
      } catch {
        // keep the last numbers
      }
    }
    await updateMarketingVideo(b.id, v.id, next);
  }
  return listMarketingVideos(b.id);
}

// What the owner's browser may see about a video (no browser session details).
export type PublicVideo = {
  id: string;
  title: string;
  angle: string;
  tool: string;
  toolName: string;
  status: MarketingVideoRow["status"];
  videoUrl: string;
  waiting: { kind: string; label: string; detail: string; url: string } | null;
  steps: { label: string; status: string }[];
  dailyUsd: number | null;
  stats: { views: number; impressions: number; clicks: number; spend: number; chats: number };
  error: string;
  createdAt: string;
};

export function publicVideo(v: MarketingVideoRow): PublicVideo {
  const w = v.job.waiting;
  return {
    id: v.id,
    title: v.title,
    angle: v.angle,
    tool: v.tool,
    toolName: videoToolOf(v.tool).name,
    status: v.status,
    videoUrl: v.videoUrl,
    waiting: v.status === "making" && v.job.state === "waiting" && w ? { kind: w.kind, label: w.label, detail: w.detail, url: w.url } : null,
    steps: (v.job.steps ?? []).slice(-8),
    dailyUsd: typeof v.meta.dailyUsd === "number" ? v.meta.dailyUsd : null,
    stats: { views: v.stats.views ?? 0, impressions: v.stats.impressions ?? 0, clicks: v.stats.clicks ?? 0, spend: v.stats.spend ?? 0, chats: v.stats.chats ?? 0 },
    error: v.job.error || v.meta.error || "",
    createdAt: v.createdAt,
  };
}
