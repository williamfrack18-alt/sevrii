import type { MessageParam, Tool, ToolResultBlockParam, ToolUseBlock, TextBlock } from "@anthropic-ai/sdk/resources/messages";
import { MODEL, getClaude, logAiError } from "./claude";
import type { Lang } from "./i18n";
import {
  createCampaignSpec,
  deleteCampaign,
  listCampaigns,
  listServices,
  updateBusinessMarketing,
  updateCampaignSpec,
  type BusinessRow,
  type CampaignRow,
} from "./db";
import { activeOffer, normalizePhone } from "./site";
import { maxDailySpend, missingForMarketing, normalizeCampaign, parseMarketing } from "./marketing";

// Marketing tab = one chat. The "brain" interviews the owner, writes a funnel
// strategy and builds campaigns that map 1:1 to Meta / Google structures.
// It never publishes or spends money and never invents results.

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
    description: "Save what you learned about the owner's marketing situation. Send only the fields you learned.",
    input_schema: {
      type: "object",
      properties: {
        goal: { type: "string", description: "What they want, e.g. 'more calls for AC repair'" },
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
    description: "Save the funnel strategy (replaces the previous one).",
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
              channel: { type: "string", description: "e.g. 'Facebook + Instagram ads', 'Google Search', 'WhatsApp Status', 'Google Business Profile'" },
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
      "Create (no id) or update (with id) one campaign ready to launch. Meta: 1 campaign → 1 ad set → 2-3 ads. Google Search: headlines ≤30 chars (8-15), descriptions ≤90 chars (2-4), keywords.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        goal: { type: "string" },
        platform: { type: "string", enum: ["meta", "google"] },
        objective: { type: "string", enum: ["calls", "messages", "leads", "traffic"] },
        destination: { type: "string", enum: ["call", "whatsapp", "messenger", "website"] },
        specialCategory: { type: "string", enum: ["none", "credit", "employment", "housing", "financial"] },
        city: { type: "string" },
        radiusMiles: { type: "number" },
        ageMin: { type: "number" },
        ageMax: { type: "number" },
        language: { type: "string", enum: ["es", "en"] },
        dailyBudgetUsd: { type: "number" },
        durationDays: { type: "number" },
        ads: { type: "array", items: adSchema, description: "Meta only: 2-3 variations to test" },
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
    name: "delete_campaign",
    description: "Delete a campaign by id (only if the owner asks).",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
];

const SYSTEM = `You are the marketing brain of Sevrii, for small US service businesses. In this chat you (1) understand the business, (2) design a simple funnel strategy, (3) build ready-to-launch campaigns.

How to work:
- Ask ONE question at a time, short and friendly, following the "missing" list in the state. Use what you already know from the store (services, prices, offer, area) instead of asking again.
- Save each answer right away with save_profile, confirm in a few words, ask the next thing.
- When you know goal, main service, monthly budget, area, ideal customer and customers' language: write the strategy with save_strategy and explain it in 3-4 short lines.
- Then build the first campaign with save_campaign. Defaults for US local services:
  · Meta (Facebook + Instagram) "Call now" ad (objective calls, destination call) when they have a phone — calls convert best for local services.
  · Messages to WhatsApp when the owner uses WhatsApp and their customers prefer to text; Messenger otherwise.
  · Google Search when people actively search for the service and the budget allows (≥ ~$15/day).
  · Small budgets: ONE campaign, ONE ad set. Daily budget = monthly budget / 30, rounded.
  · Ad copy in the customers' language, benefit first, mention the real price or offer from the store if there is one.
- Special ad categories (credit, loans, financial products, housing/real estate, employment): set specialCategory; targeting is then limited (15+ mile radius, ages 18-65+, no gender). Tell the owner.
- Meta policy: never write copy that asserts personal attributes ("Are you divorced?", "Do you have debt?"). Target by location and by the language of the ad copy, never by ethnicity, religion or other personal attributes.
- NEVER invent facts, prices, guarantees, licenses, reviews, or results. NEVER promise leads, calls, costs per lead or ROI — say results depend on the market and are measured after launch.
- Sevrii does not publish or spend anything yet: campaigns are drafts the owner launches in Meta Ads Manager / Google Ads (automatic publishing is "coming soon"). Meta charges the owner's card directly and may spend up to 1.75× the daily budget on a given day (never more than 7× per week); state taxes may apply.
- If they don't have a Facebook page or ad account, tell them in one line what they need before launching.
- "brainPlan" is the business strategy the owner already made with Sevrii's Brain (service, customer, promise, packages, offer, recommended campaign type and channels). Start from it: don't re-ask what it already answers, and build the first campaign of the type it recommends unless the owner wants otherwise.
- Keep replies under 80 words. No markdown headings.`;

export type MarketingChatResult = { reply: string; business: BusinessRow; campaigns: CampaignRow[] };

async function state(b: BusinessRow, campaigns: CampaignRow[]) {
  const services = await listServices(b.id);
  return {
    business: { name: b.name, category: b.category, city: b.city, slug: b.slug, published: Boolean(b.published) },
    store: {
      services: services.map((s) => ({ name: s.name, price: s.price })),
      offer: activeOffer(b.site),
      phone: b.site.phone || null,
      whatsapp: normalizePhone(b.whatsapp),
      serviceArea: b.site.serviceArea,
      pageUrl: `https://sevrii.com/site/${b.slug}`,
    },
    brainPlan: b.plan.service ? { service: b.plan.service, customer: b.plan.customer, promise: b.plan.promise, packages: b.plan.packages, offer: b.plan.offer, campaignType: b.plan.campaignType, channels: b.plan.channels } : null,
    marketing: b.marketing,
    campaigns: campaigns.map((c) => ({ id: c.id, title: c.title, goal: c.goal, spec: c.spec })),
    missing: missingForMarketing(b.marketing, campaigns.length),
  };
}

async function runTool(name: string, input: Record<string, unknown>, b: BusinessRow, campaigns: CampaignRow[], lang: Lang): Promise<string> {
  switch (name) {
    case "save_profile": {
      const m = parseMarketing({ ...b.marketing, profile: { ...b.marketing.profile, ...input } });
      await updateBusinessMarketing(b.id, m);
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
      if (typeof input.id === "string" && input.id) {
        if (!campaigns.some((c) => c.id === input.id)) return "error: unknown campaign id";
        await updateCampaignSpec(input.id, b.id, title, goal, spec);
      } else {
        if (campaigns.length >= 20) return "error: too many campaigns";
        await createCampaignSpec(b.id, title, goal, spec);
      }
      const notes = [
        `saved. daily $${spec.dailyBudgetUsd}, Meta may spend up to $${maxDailySpend(spec.dailyBudgetUsd)} on a single day`,
        spec.specialCategory !== "none" ? `special ad category ${spec.specialCategory}: radius ≥15 mi, ages 18-65+` : "",
        warnings.includes("metaLong") ? "some Meta text is long and will be cut on phones" : "",
        warnings.includes("googleShort") ? "Google needs at least 3 headlines ≤30 chars and 2 descriptions ≤90 chars — fix it" : "",
      ].filter(Boolean);
      return notes.join("; ");
    }
    case "delete_campaign": {
      if (typeof input.id !== "string" || !campaigns.some((c) => c.id === input.id)) return "error: unknown campaign id";
      await deleteCampaign(input.id, b.id);
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

  const system = `${SYSTEM}\n\nReply in ${es ? "Spanish (neutral, 'tú')" : "English"}.`;
  const messages: MessageParam[] = [
    ...opts.history.map((h): MessageParam => ({ role: h.role, content: h.content })),
    { role: "user", content: `State (JSON):\n${JSON.stringify(await state(business, campaigns))}\n\nOwner: ${opts.message}` },
  ];

  let reply = "";
  try {
    for (let step = 0; step < 6; step++) {
      const res = await client.messages.create({
        model: MODEL,
        max_tokens: 4000,
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
  if (b.plan.service && b.plan.campaignType) {
    return lang === "es"
      ? `¡Hola! Ya tengo tu estrategia del Cerebro para "${b.plan.service}" y el tipo de campaña: ${b.plan.campaignType}. Para dejarla lista me faltan pocas cosas. Primero: ¿cuánto quieres invertir en anuncios al mes?`
      : `Hi! I have your Brain strategy for "${b.plan.service}" and the campaign type: ${b.plan.campaignType}. I only need a few things to get it ready. First: how much do you want to spend on ads per month?`;
  }
  return lang === "es"
    ? `¡Hola! Soy el cerebro de marketing de Sevrii. Voy a entender tu negocio, armar tu estrategia y dejarte las campañas listas para ${b.name}. Para empezar: ¿qué quieres lograr con tus anuncios? Por ejemplo, más llamadas, más mensajes o más citas.`
    : `Hi! I'm Sevrii's marketing brain. I'll understand your business, build your strategy and leave ${b.name}'s campaigns ready. To start: what do you want your ads to achieve? For example more calls, more messages or more bookings.`;
}
