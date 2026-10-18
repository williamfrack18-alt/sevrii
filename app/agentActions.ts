"use server";

// The marketing agent, for the signed-in owner and their current business.
// The owner only approves launches and budget increases; see lib/marketingAgent.ts.
import { revalidatePath } from "next/cache";
import type { AgentResult, AgentState } from "@/lib/agentTypes";
import { getCurrentUser } from "@/lib/session";
import { limitsFor } from "@/lib/billing";
import {
  addAgentItem,
  getAgentItem,
  getBusinessById,
  getMetaConnection,
  listCampaigns,
  resolveAgentItem,
  setAgentItemStatus,
  setCampaignStatus,
  setMarketingPostStatus,
  updateBusinessMarketing,
  updateCampaignSpec,
  type BusinessRow,
  type UserRow,
} from "@/lib/db";
import { allow } from "@/lib/guard";
import { getLang } from "@/lib/lang";
import type { Lang } from "@/lib/i18n";
import { parseMarketing } from "@/lib/marketing";
import { setDailyBudget } from "@/lib/meta";
import { chatGate, runForUser } from "@/lib/usage";
import {
  agentStarted,
  agentState,
  executeStrategy,
  launchedText,
  launchOnMeta,
  metaFriendly,
  money,
  monthlyOf,
  plannedCampaigns,
  plannedMonthly,
  readyToPublishText,
  runDaily,
  usableConnection,
} from "@/lib/marketingAgent";

const MIN_BUDGET = 30;
const MAX_BUDGET = 10_000;

const TEXT = {
  es: {
    signin: "Vuelve a iniciar sesión.",
    plan: "El agente de marketing es parte del plan Pro.",
    busy: "Espera un momento e inténtalo de nuevo.",
    budget: `Escribe un presupuesto entre $${MIN_BUDGET} y $${MAX_BUDGET.toLocaleString("en-US")} al mes.`,
    aiLimit: "Ya usaste la IA incluida en tu plan por ahora. Inténtalo más tarde o mejora tu plan.",
    startFailed: "No pude poner en marcha tu estrategia ahora. Inténtalo de nuevo en unos minutos.",
    noStrategy: "Primero arma tu estrategia en el chat de arriba.",
    noCampaigns: "Tu estrategia todavía no tiene campañas. Pídele al chat que las arme.",
    noBudget: "Dile al chat cuánto quieres invertir al mes en anuncios.",
    overBudget: (total: string, budget: string) => `Tus campañas suman ${total} al mes, más que tu máximo de ${budget}. Pídele al chat que las ajuste.`,
    notFound: "No encontramos eso. Recarga la página.",
    already: "Eso ya se resolvió.",
    notLive: "Publica tu página primero: los anuncios llevan a la gente ahí.",
    notStarted: "Primero pon en marcha el agente.",
    tooOften: "El agente ya revisó hace poco. Inténtalo en una hora.",
    runFailed: "No pude revisar ahora. Inténtalo de nuevo más tarde.",
  },
  en: {
    signin: "Please sign in again.",
    plan: "The marketing agent is part of the Pro plan.",
    busy: "Wait a moment and try again.",
    budget: `Enter a budget between $${MIN_BUDGET} and $${MAX_BUDGET.toLocaleString("en-US")} a month.`,
    aiLimit: "You've used the AI included in your plan for now. Try later or upgrade your plan.",
    startFailed: "I couldn't put your strategy to work right now. Try again in a few minutes.",
    noStrategy: "First build your strategy in the chat above.",
    noCampaigns: "Your strategy has no campaigns yet. Ask the chat to build them.",
    noBudget: "Tell the chat how much you want to invest in ads per month.",
    overBudget: (total: string, budget: string) => `Your campaigns add up to ${total} a month, more than your ${budget} maximum. Ask the chat to adjust them.`,
    notFound: "We couldn't find that. Reload the page.",
    already: "That was already handled.",
    notLive: "Publish your page first: the ads send people there.",
    notStarted: "Start the agent first.",
    tooOften: "The agent checked a moment ago. Try again in an hour.",
    runFailed: "I couldn't check right now. Try again later.",
  },
};
type T = (typeof TEXT)["es"];

type Ctx =
  | { ok: false; error: string }
  | { ok: true; t: T; lang: Lang; user: UserRow; business: BusinessRow };

// The signed-in owner with Marketing in their plan, and their current business.
async function context(): Promise<Ctx> {
  const lang = await getLang();
  const t = TEXT[lang];
  const user = await getCurrentUser();
  if (!user || !user.business) return { ok: false, error: t.signin };
  if (!limitsFor(user).autoMarketing) return { ok: false, error: t.plan };
  if (!(await allow(`agent:act:${user.id}`, 60, 10 * 60))) return { ok: false, error: t.busy };
  const { business, ...rest } = user;
  return { ok: true, t, lang, user: rest as UserRow, business };
}

async function result(user: UserRow, businessId: string): Promise<AgentResult> {
  const fresh = await getBusinessById(businessId);
  if (!fresh) return { ok: false, error: TEXT[await getLang()].notFound };
  revalidatePath("/dashboard");
  return { ok: true, state: await agentState(fresh, user) };
}

const validId = (id: unknown): id is string => typeof id === "string" && id.length > 0 && id.length <= 64;
const validBudget = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= MIN_BUDGET && n <= MAX_BUDGET;

export async function getAgentStateAction(): Promise<AgentState | null> {
  const user = await getCurrentUser();
  if (!user || !user.business) return null;
  if (!(await allow(`agent:state:${user.id}`, 120, 10 * 60))) return null;
  const { business, ...rest } = user;
  return agentState(business, rest as UserRow);
}

// The owner approved the strategy the marketing chat built: the agent puts it
// to work (launch proposals, free posts, daily checks). Also used to approve
// changes the chat made afterwards.
export async function approveStrategyAction(): Promise<AgentResult> {
  const ctx = await context();
  if (!ctx.ok) return ctx;
  const { t, lang, user, business } = ctx;
  if (!(await allow(`agent:approve:${business.id}`, 10, 60 * 60))) return { ok: false, error: t.busy };
  // Without AI left the strategy is still approved; the posts come with the daily check.
  const gate = await chatGate(user.id);
  if (gate === "slow") return { ok: false, error: t.busy };
  try {
    const r = await executeStrategy(business, lang, { posts: gate === null });
    if (!r.ok) {
      if (r.reason === "no_strategy") return { ok: false, error: t.noStrategy };
      if (r.reason === "no_campaigns") return { ok: false, error: t.noCampaigns };
      if (r.reason === "no_budget") return { ok: false, error: t.noBudget };
      return { ok: false, error: t.overBudget(money(r.totalUsd ?? 0), money(r.budgetUsd ?? 0)) };
    }
  } catch (err) {
    console.error("[agent] execute failed", business.id, (err as Error)?.message);
    return { ok: false, error: t.startFailed };
  }
  return result(user, business.id);
}

export async function setAgentBudgetAction(monthlyBudgetUsd: number): Promise<AgentResult> {
  const ctx = await context();
  if (!ctx.ok) return ctx;
  const { t, user, business } = ctx;
  if (!validBudget(monthlyBudgetUsd)) return { ok: false, error: t.budget };
  const budget = Math.round(monthlyBudgetUsd * 100) / 100;
  const m = parseMarketing({ ...business.marketing, profile: { ...business.marketing.profile, monthlyBudgetUsd: budget } });
  await updateBusinessMarketing(business.id, m);

  // Lower than what the campaigns add up to: tell the owner which ones to adjust.
  const campaigns = await listCampaigns(business.id);
  const total = plannedMonthly(campaigns);
  if (total > budget) {
    const es = business.site.lang !== "en";
    const list = plannedCampaigns(campaigns)
      .map((c) => (es ? `«${c.title}» (${money(monthlyOf(c))} al mes)` : `“${c.title}” (${money(monthlyOf(c))} a month)`))
      .join(", ");
    await addAgentItem({
      businessId: business.id,
      kind: "info",
      status: "auto",
      title: es ? `Tus campañas suman ${money(total)} al mes, más que tu nuevo máximo de ${money(budget)}` : `Your campaigns add up to ${money(total)} a month, more than your new ${money(budget)} maximum`,
      detail: es
        ? `Baja el presupuesto o pausa alguna de estas: ${list}. Las propuestas que no has aprobado puedes descartarlas.`
        : `Lower the budget or pause one of these: ${list}. You can dismiss proposals you haven't approved.`,
    });
  }
  return result(user, business.id);
}

export async function approveAgentItemAction(id: string): Promise<AgentResult> {
  const ctx = await context();
  if (!ctx.ok) return ctx;
  const { t, user, business } = ctx;
  if (!validId(id)) return { ok: false, error: t.notFound };
  const item = await getAgentItem(business.id, id);
  if (!item) return { ok: false, error: t.notFound };
  if (item.status !== "pending") return { ok: false, error: t.already };
  const es = business.site.lang !== "en";
  const campaigns = await listCampaigns(business.id);
  const campaign = item.campaignId ? campaigns.find((c) => c.id === item.campaignId) : undefined;
  const conn = usableConnection(await getMetaConnection(business.id));

  if (item.kind === "launch") {
    if (!campaign?.spec) return { ok: false, error: t.notFound };
    // Google campaigns aren't published by the agent: approved = ready to copy into Google Ads.
    if (campaign.spec.platform !== "meta") {
      if (!(await resolveAgentItem(business.id, item.id, "done"))) return { ok: false, error: t.already };
      await setCampaignStatus(business.id, campaign.id, "approved");
      const r = readyToPublishText(business, campaign);
      await addAgentItem({ businessId: business.id, kind: "info", status: "auto", campaignId: campaign.id, title: r.title, detail: r.detail });
      return result(user, business.id);
    }
    // Checked before taking the approval, so the item stays waiting.
    if (conn && (!business.published || !limitsFor(user).canPublish)) return { ok: false, error: t.notLive };
    if (!(await resolveAgentItem(business.id, item.id, "approved"))) return { ok: false, error: t.already };

    // The owner approved the daily budget shown on the item: launch exactly that.
    const shown = Number(item.payload?.dailyBudgetUsd);
    let c = campaign;
    if (Number.isFinite(shown) && shown > 0 && shown !== c.spec!.dailyBudgetUsd) {
      const spec = { ...c.spec!, dailyBudgetUsd: shown };
      await updateCampaignSpec(c.id, business.id, c.title, c.goal, spec);
      c = { ...c, spec };
    }

    if (conn) {
      const r = await runForUser(user.id, () => launchOnMeta(business, c, conn));
      if (r.ok) {
        const d = launchedText(business, c);
        await setAgentItemStatus(business.id, item.id, "done", `${d.title}. ${d.detail}`);
      } else {
        // Stays approved: the daily check publishes it once the problem is fixed.
        await setCampaignStatus(business.id, c.id, "approved");
        await setAgentItemStatus(business.id, item.id, "error", es ? `No pude publicarla: ${r.error}` : `I couldn't publish it: ${r.error}`);
      }
    } else {
      await setCampaignStatus(business.id, c.id, "approved");
      await setAgentItemStatus(business.id, item.id, "done");
      const r = readyToPublishText(business, c);
      await addAgentItem({ businessId: business.id, kind: "info", status: "auto", campaignId: c.id, title: r.title, detail: r.detail });
    }
    return result(user, business.id);
  }

  if (item.kind === "budget") {
    if (!campaign?.spec) return { ok: false, error: t.notFound };
    if (!(await resolveAgentItem(business.id, item.id, "approved"))) return { ok: false, error: t.already };
    const spec = campaign.spec;
    const budget = business.marketing.profile.monthlyBudgetUsd;
    const asked = Number(item.payload?.toDaily) || 0;
    // Re-checked now: the monthly maximum may have changed since it was proposed.
    const room = budget ? Math.floor(((budget - plannedMonthly(campaigns, campaign.id)) / 30) * 100) / 100 : 0;
    const to = Math.min(asked, room);
    if (!(to > spec.dailyBudgetUsd)) {
      await setAgentItemStatus(
        business.id,
        item.id,
        "error",
        es ? "Ya no cabe en tu presupuesto mensual, así que la dejé igual." : "It no longer fits your monthly budget, so I left it as it was."
      );
      return result(user, business.id);
    }
    const onMeta = Boolean(campaign.meta?.campaignId && campaign.meta.adSetId);
    try {
      if (onMeta) {
        if (!conn) {
          await setAgentItemStatus(
            business.id,
            item.id,
            "error",
            es ? "Conecta Facebook de nuevo para poder cambiar el presupuesto." : "Connect Facebook again so I can change the budget."
          );
          return result(user, business.id);
        }
        await setDailyBudget(conn, campaign.meta!, to);
      }
      await updateCampaignSpec(campaign.id, business.id, campaign.title, campaign.goal, { ...spec, dailyBudgetUsd: to });
      await setAgentItemStatus(
        business.id,
        item.id,
        "done",
        es
          ? `Listo: ${money(spec.dailyBudgetUsd)} → ${money(to)} al día (unos ${money(to * 30)} al mes).`
          : `Done: ${money(spec.dailyBudgetUsd)} → ${money(to)} a day (about ${money(to * 30)} a month).`
      );
    } catch (err) {
      await setAgentItemStatus(business.id, item.id, "error", metaFriendly(err, es ? "es" : "en"));
    }
    return result(user, business.id);
  }

  // Anything else that waits for an OK just gets marked done.
  if (!(await resolveAgentItem(business.id, item.id, "done"))) return { ok: false, error: t.already };
  return result(user, business.id);
}

export async function dismissAgentItemAction(id: string): Promise<AgentResult> {
  const ctx = await context();
  if (!ctx.ok) return ctx;
  const { t, user, business } = ctx;
  if (!validId(id)) return { ok: false, error: t.notFound };
  const item = await getAgentItem(business.id, id);
  if (!item) return { ok: false, error: t.notFound };
  if (!(await resolveAgentItem(business.id, item.id, "dismissed"))) return { ok: false, error: t.already };
  if (item.kind === "launch" && item.campaignId) {
    // A turned-down proposal stays visible in the strategy as "declined"; if the
    // chat changes it later it goes back to draft and can be approved again.
    const c = (await listCampaigns(business.id)).find((x) => x.id === item.campaignId);
    if (c?.status === "proposed") await setCampaignStatus(business.id, c.id, "declined");
  }
  return result(user, business.id);
}

export async function markPostUsedAction(id: string): Promise<AgentResult> {
  const ctx = await context();
  if (!ctx.ok) return ctx;
  const { t, user, business } = ctx;
  if (!validId(id)) return { ok: false, error: t.notFound };
  await setMarketingPostStatus(business.id, id, "used");
  return result(user, business.id);
}

export async function runAgentNowAction(): Promise<AgentResult> {
  const ctx = await context();
  if (!ctx.ok) return ctx;
  const { t, user, business } = ctx;
  if (!(await agentStarted(business))) return { ok: false, error: t.notStarted };
  if (!(await allow(`agent:run:${business.id}`, 3, 60 * 60))) return { ok: false, error: t.tooOften };
  try {
    await runDaily(business.id);
  } catch (err) {
    console.error("[agent] run now failed", business.id, (err as Error)?.message);
    return { ok: false, error: t.runFailed };
  }
  return result(user, business.id);
}
