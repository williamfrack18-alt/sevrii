import type { MessageParam, Tool, ToolResultBlockParam, ToolUseBlock, TextBlock } from "@anthropic-ai/sdk/resources/messages";
import { MODEL, getClaude, logAiError } from "./claude";
import type { Lang } from "./i18n";
import {
  createCampaignSpec,
  deleteCampaign,
  listAgentItems,
  listCampaigns,
  listServices,
  setAgentItemStatus,
  setCampaignStatus,
  updateBusinessMarketing,
  updateBusinessPlan,
  updateCampaignSpec,
  type BusinessRow,
  type CampaignRow,
} from "./db";
import { maxDailySpend, normalizeCampaign, parseMarketing } from "./marketing";
import { parsePlan } from "./plan";
import { businessFacts, monthlyOf } from "./marketingAgent";

// Marketing tab = one chat, and the chat is the strategist. It already knows
// the Brain plan and the store page, asks only what's missing (usually the
// monthly budget), builds the strategy and the campaigns, and explains them.
// Nothing runs until the owner taps "Aprobar estrategia"; then the agent
// (lib/marketingAgent.ts executeStrategy) puts it to work. After approval the
// chat keeps adjusting the strategy on request. It never invents results.

const adSchema = {
  type: "object",
  properties: {
    primaryText: { type: "string", description: "Main ad text, ideally ≤125 characters" },
    headline: { type: "string", description: "≤40 characters" },
    description: { type: "string", description: "≤30 characters, optional" },
  },
  required: ["primaryText", "headline"],
};

const TOOLS: Tool[] = [
  {
    name: "save_profile",
    description:
      "Save what you know about the owner's marketing situation: what they told you AND what the facts already answer (Brain plan, page). Send only the fields you know.",
    input_schema: {
      type: "object",
      properties: {
        goal: { type: "string", description: "What they want, e.g. 'more chats and bookings for AC repair'" },
        monthlyBudgetUsd: { type: "number" },
        avgTicketUsd: { type: "number", description: "Average sale per customer, if they said it" },
        mainService: { type: "string" },
        idealCustomer: { type: "string" },
        area: { type: "string", description: "City / zone to target" },
        radiusMiles: { type: "number" },
        customerLanguage: { type: "string", enum: ["es", "en", "both"] },
        hasFacebookPage: { type: "boolean" },
        hasAdAccount: { type: "boolean", description: "Has a Meta ad account with a payment method" },
      },
    },
  },
  {
    name: "save_strategy",
    description: "Save the marketing strategy (replaces the previous one). The owner sees it as a card in this chat, each part opening in place.",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "2-3 sentences: the plan in plain words" },
        budgetPlan: { type: "string", description: "How to split the monthly budget, in USD" },
        stages: {
          type: "array",
          description: "Up to 4 funnel stages. Small budgets: focus on conversion.",
          items: {
            type: "object",
            properties: {
              stage: { type: "string", enum: ["awareness", "consideration", "conversion", "retention"] },
              title: { type: "string" },
              channel: { type: "string", description: "e.g. 'Facebook + Instagram ads', 'Google Search', 'Google Business Profile', 'referrals'" },
              message: { type: "string", description: "What to say at this stage" },
              action: { type: "string", description: "The concrete thing to do" },
            },
            required: ["stage", "title", "channel", "message", "action"],
          },
        },
      },
      required: ["summary", "stages"],
    },
  },
  {
    name: "save_campaign",
    description:
      "Create (no id) or update (with id) one campaign of the strategy. Meta: 1 campaign → 1 ad set → exactly 3 ads. Google Search: headlines ≤30 chars (8-15), descriptions ≤90 chars (2-4), keywords. It is a proposal: nothing is published or spent until the owner approves.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        goal: { type: "string" },
        platform: { type: "string", enum: ["meta", "google"] },
        objective: { type: "string", enum: ["leads", "traffic"] },
        destination: { type: "string", enum: ["website"] },
        specialCategory: { type: "string", enum: ["none", "credit", "employment", "housing", "financial"] },
        city: { type: "string" },
        radiusMiles: { type: "number" },
        ageMin: { type: "number" },
        ageMax: { type: "number" },
        language: { type: "string", enum: ["es", "en"] },
        dailyBudgetUsd: { type: "number" },
        durationDays: { type: "number" },
        ads: { type: "array", items: adSchema, description: "Meta only: exactly 3 variations with different angles" },
        headlines: { type: "array", items: { type: "string" }, description: "Google only" },
        descriptions: { type: "array", items: { type: "string" }, description: "Google only" },
        keywords: { type: "array", items: { type: "string" }, description: "Google only" },
        negativeKeywords: { type: "array", items: { type: "string" } },
        notes: { type: "string", description: "Short tip for the owner" },
      },
      required: ["title", "goal", "platform", "objective", "dailyBudgetUsd", "durationDays"],
    },
  },
  {
    name: "save_media",
    description: "Save the video script and/or the photo ideas for the owner's ads and page (send only what changes; photoIdeas replaces the list).",
    input_schema: {
      type: "object",
      properties: {
        videoScript: { type: "string", description: "30-60 second script in first person, to record with a phone; use [tu nombre] for their name" },
        photoIdeas: { type: "array", items: { type: "string" } },
      },
    },
  },
  {
    name: "delete_campaign",
    description: "Delete a campaign by id (only if the owner asks, or to replace it with a better one). Live campaigns can't be deleted here.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
];

const SYSTEM = `You are Sevrii's marketing strategist for ONE small US service business. The owner is not technical. You are the brain: first you build the right strategy together in this chat; only after the owner approves it does the agent execute it.

What you already know (the state's "facts"): the Brain plan the owner made with Sevrii (service, customer, problem, fears, promise, differentiators, recommended campaign type and channels), the store page (services with prices, offer, area and reach, key points, language) and the marketing profile. NEVER ask what the facts already answer. On your first turn, save with save_profile what the facts tell you (goal, mainService, idealCustomer, area, radiusMiles, customerLanguage) without asking.

How to work:
1) Ask ONLY what is missing and essential, ONE short question at a time, following "toAsk" — usually just the monthly ad budget (in USD, minimum $30), and the goal only if it isn't clear from the facts. Don't ask about Facebook pages or ad accounts: the agent handles that when launching. Save each answer right away with save_profile.
2) As soon as you have the budget: in the SAME turn save the strategy (save_strategy) and its campaigns (save_campaign). Strategy = summary (2-3 plain sentences), up to 4 funnel stages (awareness = attract, consideration = convince, conversion = convert, retention = keep them coming back), each with a channel and one concrete action, and budgetPlan (how the monthly budget is split, in USD). Small budgets focus on conversion. Start from the Brain plan's promise, customer and recommended campaign type.
3) Explain it in the chat in 3-5 short lines: who it's for, the message, each campaign with its money per day and per month, and the free posts the agent will prepare. Ask if they agree or want to change something. Change whatever they ask.
Marketing is the ONLY place for marketing: the campaign type, the ads, the posts, and the video and photos. The Brain plan only suggests them (recommended campaign type and channels, videoScript, photoIdeas) — use them as a starting point; when the owner wants to change the video script or the photo ideas, save them with save_media. If the facts have Brain plan "notes" (e.g. Meta's special ad category for legal, credit, housing or employment services), tell the owner about them in plain words when you present the strategy.
4) When the owner agrees, tell them to tap the button "Aprobar estrategia y ponerla en marcha" ("Approve strategy and put it to work" in English) in their strategy card, right here in the chat. Approving puts the agent to work: it asks their OK before launching each campaign and before any budget increase, prepares free posts for their pages, and checks results every day. On its own it may only pause an ad that spends without bringing chats and write new ad texts — never spend more.

State "approved": false → everything is a PROPOSAL. Never say a campaign is running, launched, published, active or spending.
State "approved": true → the agent is executing the approved strategy. When the owner asks for changes, update the strategy or campaigns; new or changed campaigns wait for the owner again: tell them to tap "Aprobar cambios" ("Approve changes"). Campaigns with status live or paused are on Facebook: you may rewrite their ad texts, but their budget only changes through the agent's proposal that the owner approves (in "Needs your approval"). Don't promise results; the owner sees visits, chats and contacts in the agent panel.

Campaign rules:
- Customers contact the business ONLY through the AI chat on its Sevrii page. Every ad sends people to the page (objective traffic, destination website, button "Más información"/"Learn more") and invites them to write through the page chat. Never propose calls, texts, WhatsApp or phone numbers.
- Prices and offers ONLY from facts.page.services and facts.page.offer (what customers see on the page). The Brain plan's packages may be outdated: never quote them. Mention a price or offer only if it's there.
- Default: Meta (Facebook + Instagram), 1 campaign → 1 ad set → exactly 3 ad variations with different angles, durationDays 30. Local businesses: the page's area and radius; online businesses: the whole US.
- Google Search only when people actively search for the service and the budget allows (≥ ~$15/day on top of Meta).
- The sum of dailyBudgetUsd × 30 of all campaigns must be ≤ the monthly budget ("plannedMonthlyUsd" shows the current sum). Under ~$300/month: ONE campaign. Two only if each gets ≥ $5/day (e.g. one per customer language when customers speak both).
- Ads in the customers' language. Benefit first, ≤125 characters of main text, headline ≤40.
- Special ad categories (credit, loans, financial products, housing/real estate, employment): set specialCategory; targeting is then limited (15+ mile radius, ages 18-65+). Tell the owner in one line.
- Meta policy: never assert or imply personal attributes ("Are you divorced?", "Do you have debt?"). Target only by location and ad language, never by ethnicity, religion or other personal attributes.
- NEVER invent facts, prices, discounts, guarantees, licenses, insurance, reviews or results. NEVER promise leads, calls, chats, cost per lead or ROI: results depend on the market and are measured after launch (each campaign has its own link, so Sevrii counts the visits, chats and contacts it brings).
- Meta charges the owner's card directly and may spend up to 1.75× the daily budget on one day (never more than 7× in a week); taxes may apply.

Style: warm, plain, short sentences a neighbor would understand. Under 90 words (up to 140 when you present the strategy). No markdown headings, tables, bold or emojis.`;

// One language for the owner, everywhere: what they read in this chat and
// in the panel is never a mix. Only the ads and posts (what customers see) go
// in the customers' language.
function ownerLanguageRule(lang: Lang): string {
  const name = lang === "es" ? "Spanish (neutral, 'tú')" : "English";
  return `Language: the owner reads Sevrii in ${name}. Write in ${name} your replies AND every field the owner reads: the strategy (summary, stage actions, budgetPlan), the profile (goal, mainService, idealCustomer, area), each campaign's title, goal and audience, and the video script and photo ideas — even when the facts, the Brain plan or the owner's message are in another language (translate them). Only what customers see goes in the customers' language: the ad texts (primary text, headline, description) and the posts.`;
}

export type MarketingChatResult = { reply: string; business: BusinessRow; campaigns: CampaignRow[] };

// Only what really has to be asked; everything else comes from the facts.
function toAsk(b: BusinessRow, serviceCount: number): string[] {
  const p = b.marketing.profile;
  const out: string[] = [];
  if (p.monthlyBudgetUsd === null) out.push("monthlyBudgetUsd");
  if (!p.goal && !b.plan.service && !p.mainService && serviceCount === 0) out.push("goal");
  if (!p.area && !b.site.reachMode && !b.site.baseCity && !b.plan.profile.city && !b.city) out.push("area");
  return out;
}

async function state(b: BusinessRow, campaigns: CampaignRow[]) {
  const [facts, services] = await Promise.all([businessFacts(b), listServices(b.id)]);
  const approved = Boolean(b.marketing.approvedAt);
  const next: string[] = [];
  if (!b.marketing.strategy) next.push("strategy");
  if (!campaigns.some((c) => c.spec)) next.push("campaigns");
  if (b.marketing.strategy && campaigns.some((c) => c.spec) && !approved) next.push("owner approves with the button");
  if (approved && campaigns.some((c) => c.spec && c.status === "draft")) next.push("owner approves the changes with the button");
  return {
    approved,
    approvedAt: b.marketing.approvedAt ?? null,
    facts,
    pageUrl: `https://sevrii.com/site/${b.slug}`,
    pagePublished: Boolean(b.published),
    marketing: { profile: b.marketing.profile, strategy: b.marketing.strategy },
    campaigns: campaigns
      .filter((c) => c.spec)
      .map((c) => ({ id: c.id, title: c.title, goal: c.goal, status: c.status, monthlyUsd: monthlyOf(c), spec: c.spec })),
    plannedMonthlyUsd: Math.round(campaigns.filter((c) => c.spec && c.status !== "declined").reduce((s, c) => s + monthlyOf(c), 0) * 100) / 100,
    toAsk: toAsk(b, services.length),
    next,
  };
}

// The pending launch proposal of a campaign is withdrawn when the chat changes it.
async function withdrawProposal(b: BusinessRow, campaignId: string) {
  const items = await listAgentItems(b.id, 200);
  for (const it of items) {
    if (it.kind === "launch" && it.status === "pending" && it.campaignId === campaignId) await setAgentItemStatus(b.id, it.id, "dismissed");
  }
}

const isOnMeta = (c: CampaignRow) => Boolean(c.meta?.campaignId) || c.status === "live" || c.status === "paused";

async function runTool(name: string, input: Record<string, unknown>, b: BusinessRow, campaigns: CampaignRow[], lang: Lang): Promise<string> {
  switch (name) {
    case "save_profile": {
      const m = parseMarketing({ ...b.marketing, profile: { ...b.marketing.profile, ...input } });
      await updateBusinessMarketing(b.id, m);
      return "saved";
    }
    case "save_media": {
      const patch: Record<string, unknown> = {};
      if (typeof input.videoScript === "string") patch.videoScript = input.videoScript;
      if (Array.isArray(input.photoIdeas)) patch.photoIdeas = input.photoIdeas;
      await updateBusinessPlan(b.id, parsePlan({ ...b.plan, ...patch }));
      return "saved";
    }
    case "save_strategy": {
      const m = parseMarketing({ ...b.marketing, strategy: input });
      await updateBusinessMarketing(b.id, m);
      return "saved";
    }
    case "save_campaign": {
      const { spec, warnings } = normalizeCampaign(input, {
        category: b.category,
        city: b.marketing.profile.area || b.site.serviceArea || b.city || "",
        defaultLang: lang,
      });
      const title = String(input.title || "").trim().slice(0, 80) || "Campaign";
      const goal = String(input.goal || "").trim().slice(0, 160) || b.marketing.profile.goal || "";
      const extra: string[] = [];
      let savedId: string;
      if (typeof input.id === "string" && input.id) {
        const old = campaigns.find((c) => c.id === input.id);
        if (!old) return "error: unknown campaign id";
        if (isOnMeta(old) && old.spec) {
          // On Facebook already: only the texts change here; money goes through the owner's OK.
          spec.platform = old.spec.platform;
          spec.dailyBudgetUsd = old.spec.dailyBudgetUsd;
          spec.durationDays = old.spec.durationDays;
          extra.push("this campaign is on Facebook: texts saved, budget and duration kept (a budget change must be approved by the owner in the agent panel)");
        } else if (old.status === "proposed" || old.status === "declined" || old.status === "approved") {
          // Changed after approval: back to the owner ("Aprobar cambios").
          await withdrawProposal(b, old.id);
          await setCampaignStatus(b.id, old.id, "draft");
          if (b.marketing.approvedAt) extra.push("changed: the owner must tap 'Aprobar cambios' to send it to launch");
        }
        await updateCampaignSpec(old.id, b.id, title, goal, spec);
        savedId = old.id;
      } else {
        if (campaigns.length >= 20) return "error: too many campaigns";
        savedId = await createCampaignSpec(b.id, title, goal, spec);
        if (b.marketing.approvedAt) extra.push("new campaign: the owner must tap 'Aprobar cambios' to send it to launch");
      }
      const budget = b.marketing.profile.monthlyBudgetUsd;
      const others = campaigns.filter((c) => c.id !== savedId && c.spec && c.status !== "declined").reduce((s, c) => s + monthlyOf(c), 0);
      const total = others + spec.dailyBudgetUsd * 30;
      if (budget && total > budget + 0.5) extra.push(`warning: campaigns now add up to $${Math.round(total)}/month, over the owner's $${budget} monthly budget — lower the daily budgets so the sum fits`);
      const notes = [
        `saved (id ${savedId}). daily $${spec.dailyBudgetUsd}, Meta may spend up to $${maxDailySpend(spec.dailyBudgetUsd)} on a single day`,
        ...extra,
        spec.specialCategory !== "none" ? `special ad category ${spec.specialCategory}: radius ≥15 mi, ages 18-65+` : "",
        warnings.includes("metaLong") ? "some Meta text is long and will be cut on phones" : "",
        warnings.includes("googleShort") ? "Google needs at least 3 headlines ≤30 chars and 2 descriptions ≤90 chars — fix it" : "",
      ].filter(Boolean);
      return notes.join("; ");
    }
    case "delete_campaign": {
      const c = typeof input.id === "string" ? campaigns.find((x) => x.id === input.id) : undefined;
      if (!c) return "error: unknown campaign id";
      if (isOnMeta(c)) return "error: this campaign is on Facebook; it can't be deleted from the chat (the owner can pause it)";
      await withdrawProposal(b, c.id);
      await deleteCampaign(c.id, b.id);
      return "deleted";
    }
    default:
      return "error: unknown tool";
  }
}

export async function runMarketingChatTurn(opts: {
  business: BusinessRow;
  reload: () => Promise<BusinessRow>;
  history: { role: "user" | "assistant"; content: string }[];
  message: string;
  lang: Lang;
}): Promise<MarketingChatResult> {
  let business = opts.business;
  let campaigns = await listCampaigns(business.id);
  const es = opts.lang === "es";
  const client = getClaude();
  if (!client) {
    console.error("[ai:marketing] ANTHROPIC_API_KEY is not set");
    return {
      reply: es
        ? "El asistente no está disponible en este momento. Inténtalo de nuevo en unos minutos."
        : "The assistant isn't available right now. Please try again in a few minutes.",
      business,
      campaigns,
    };
  }

  const system = `${SYSTEM}\n\n${ownerLanguageRule(opts.lang)}`;
  const messages: MessageParam[] = [
    ...opts.history.map((h): MessageParam => ({ role: h.role, content: h.content })),
    { role: "user", content: `State (JSON):\n${JSON.stringify(await state(business, campaigns))}\n\nOwner: ${opts.message}` },
  ];

  let reply = "";
  try {
    for (let step = 0; step < 8; step++) {
      const res = await client.messages.create({
        model: MODEL,
        max_tokens: 6000,
        thinking: { type: "between_tools" },
        output_config: { effort: "low" },
        system,
        tools: TOOLS,
        messages,
      });
      const text = res.content
        .filter((c): c is TextBlock => c.type === "text")
        .map((c) => c.text)
        .join("\n")
        .trim();
      if (text) reply = text;
      const uses = res.content.filter((c): c is ToolUseBlock => c.type === "tool_use");
      if (res.stop_reason !== "tool_use" || uses.length === 0) break;

      const results: ToolResultBlockParam[] = [];
      for (const u of uses) {
        let out: string;
        try {
          out = await runTool(u.name, (u.input ?? {}) as Record<string, unknown>, business, campaigns, opts.lang);
        } catch (err) {
          console.error("[ai:marketing] tool failed", u.name, err);
          out = "error: could not save";
        }
        business = await opts.reload();
        campaigns = await listCampaigns(business.id);
        results.push({ type: "tool_result", tool_use_id: u.id, content: out });
      }
      messages.push({ role: "assistant", content: res.content });
      messages.push({
        role: "user",
        content: [...results, { type: "text", text: `Updated state (JSON):\n${JSON.stringify(await state(business, campaigns))}` }],
      });
    }
  } catch (err) {
    logAiError("marketing", err);
    reply = es
      ? "Tuve un problema para guardar eso. Inténtalo de nuevo en un momento."
      : "I had a problem saving that. Please try again in a moment.";
  }

  return { reply: reply || (es ? "Listo." : "Done."), business, campaigns };
}

export function marketingGreeting(lang: Lang, b: BusinessRow): string {
  const es = lang === "es";
  const service = b.plan.service;
  const budget = b.marketing.profile.monthlyBudgetUsd;
  if (b.marketing.strategy) {
    return es
      ? "Aquí está tu estrategia de marketing, en la tarjeta de este chat. Dime qué quieres cambiar o, si te gusta, toca «Aprobar estrategia y ponerla en marcha»."
      : "Your marketing strategy is in the card in this chat. Tell me what you'd like to change or, if you like it, tap \"Approve strategy and put it to work\".";
  }
  if (service && budget) {
    return es
      ? `¡Hola! Soy tu estratega de marketing. Ya conozco tu plan del Cerebro para "${service}", tu página y tu presupuesto de $${budget} al mes. ¿Armo tu estrategia ahora? Si tienes una meta en especial, cuéntamela.`
      : `Hi! I'm your marketing strategist. I already know your Brain plan for "${service}", your page and your $${budget} monthly budget. Shall I build your strategy now? If you have a specific goal, tell me.`;
  }
  if (service) {
    return es
      ? `¡Hola! Soy tu estratega de marketing. Ya conozco tu plan del Cerebro para "${service}" y tu página, así que no te voy a preguntar lo que ya sé. Para armar tu estrategia me falta una cosa: ¿cuánto quieres invertir en anuncios al mes? Puede ser desde $30.`
      : `Hi! I'm your marketing strategist. I already know your Brain plan for "${service}" and your page, so I won't ask what I already know. To build your strategy I need one thing: how much do you want to invest in ads per month? It can be as little as $30.`;
  }
  return es
    ? `¡Hola! Soy tu estratega de marketing. Primero armamos juntos la estrategia para ${b.name} y, cuando la apruebes, tu agente la pone en marcha. ¿Qué quieres lograr con tus anuncios? Por ejemplo, más mensajes de clientes o más citas.`
    : `Hi! I'm your marketing strategist. First we build ${b.name}'s strategy together and, once you approve it, your agent puts it to work. What do you want your ads to achieve? For example more customer messages or more bookings.`;
}
