import type { MessageParam, Tool, ToolResultBlockParam, ToolUseBlock, TextBlock } from "@anthropic-ai/sdk/resources/messages";
import { MODEL, getClaude, logAiError } from "./claude";
import type { Lang } from "./i18n";
import { addService, listServices, updateBusinessPlan, updateService, type BusinessRow } from "./db";
import { LIMITS } from "./site";
import { missingForPlan, parsePlan } from "./plan";

// "Cerebro" tab = one chat. It is the first step of every project: it decides
// WHAT to sell, to WHOM, HOW, at WHAT PRICE and with WHAT kind of campaign.
// Store and Marketing read this plan afterwards.

const TOOLS: Tool[] = [
  {
    name: "save_plan",
    description: "Save what you decided with the owner. Send only the fields that changed; lists replace the previous list.",
    input_schema: {
      type: "object",
      properties: {
        service: { type: "string", description: "The one service this project sells, concrete (e.g. 'EV charger installation')" },
        customer: { type: "string", description: "Who buys it and where (e.g. 'homeowners in Kissimmee with a new EV')" },
        problem: { type: "string", description: "The pain or need it solves, in the customer's words" },
        promise: { type: "string", description: "One-line value proposition, honest and specific" },
        differentiators: { type: "array", items: { type: "string" }, description: "Up to 5 real reasons to choose them (only facts the owner gave)" },
        packages: {
          type: "array",
          description: "1-3 packages with prices (good / better / best works well)",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              price: { type: "string", description: "e.g. '$450', 'from $120', '$95 visit'" },
              includes: { type: "string" },
              note: { type: "string", description: "Why this price, or who it's for" },
            },
            required: ["name", "price"],
          },
        },
        pricingNote: { type: "string", description: "How the prices were set: owner's costs, margin, what the owner says others charge. Mark estimates as estimates." },
        offer: {
          type: "object",
          description: "A real launch offer the owner agreed to (no fake urgency). Omit if none.",
          properties: { label: { type: "string" }, detail: { type: "string" } },
          required: ["label"],
        },
        campaignType: { type: "string", description: "The recommended kind of campaign in one line (e.g. 'Facebook + Instagram Call now ads, 15 mi around Kissimmee')" },
        channels: {
          type: "array",
          description: "Up to 4 channels in priority order",
          items: {
            type: "object",
            properties: { channel: { type: "string" }, why: { type: "string" } },
            required: ["channel", "why"],
          },
        },
        requirements: { type: "array", items: { type: "string" }, description: "Licenses, insurance or permits the owner should confirm for their state (say 'check', never assert the law)" },
        nextSteps: { type: "array", items: { type: "string" }, description: "Up to 5 short next actions" },
        ready: { type: "boolean", description: "true only when the owner approved the plan" },
      },
    },
  },
  {
    name: "send_to_store",
    description: "Copy the plan's packages (name, price, what's included) into the Store page as services. Only after the owner says yes.",
    input_schema: { type: "object", properties: {} },
  },
];

const SYSTEM = `You are the Brain ("Cerebro") of Sevrii, a business strategist for small US service businesses (many owners are Hispanic). Every project starts with you. With the owner you decide:
1) WHAT service to sell (one concrete service per project),
2) WHO buys it and what problem it solves,
3) HOW to present it (promise and real differentiators),
4) at WHAT PRICE (1-3 packages),
5) with what OFFER (only a real one) and what KIND OF CAMPAIGN.
After you, Store builds the sales page and Marketing builds the campaigns from this plan.

How to work:
- Ask ONE question at a time, short and friendly, following the "missing" list in the state. Use what you already know (project name, category, city, description, store services) instead of asking again.
- If mode is "new" the owner is starting a new service: help them choose it based on their experience, tools, license and area; suggest 2-3 options with one line each and let them pick.
- Save each decision right away with save_plan, confirm it in a few words, then ask the next thing.
- Pricing: ask what it costs them (materials, hours) and what others charge near them. Propose packages with a healthy margin and say how you got there. You don't have live market data: label any range as an estimate the owner should confirm. Never invent competitor prices.
- Campaign type defaults for US local services: Facebook + Instagram "Call now" ads for urgent/local jobs; Google Search when people search for it actively and budget allows (≥ ~$15/day); WhatsApp messages for Spanish-speaking customers; Google Business Profile and referrals are free channels worth listing.
- Licensed trades (electrical, plumbing, HVAC, roofing, general contracting, pest control…): add to requirements that they confirm the state license and insurance before advertising; many states require the license number in ads.
- Credit, loans, insurance, real estate, employment: note that Meta treats them as special ad categories (limited targeting) and that some (like credit repair) have extra federal rules.
- When everything is filled, give a 4-5 line summary and ask if they approve. On a clear yes: save_plan with ready=true, then ask if you should send the packages to Store. On yes, call send_to_store and tell them to continue in Store, then Marketing.
- NEVER invent facts, reviews, licenses, guarantees, results or deadlines. No fake urgency. Don't promise income or number of customers.
- Keep replies under 80 words. No markdown headings.`;

export type PlanChatResult = { reply: string; business: BusinessRow };

async function state(b: BusinessRow) {
  const services = await listServices(b.id);
  return {
    project: { name: b.name, category: b.category, city: b.city, description: b.description, pitch: b.pitch },
    store: { services: services.map((s) => ({ name: s.name, price: s.price })), published: Boolean(b.published), phone: b.site.phone || null, licenseNumber: b.site.licenseNumber || null },
    plan: b.plan,
    missing: missingForPlan(b.plan),
  };
}

async function sendToStore(b: BusinessRow): Promise<string> {
  const packages = b.plan.packages;
  if (packages.length === 0) return "error: the plan has no packages yet";
  const services = await listServices(b.id);
  let added = 0;
  let updated = 0;
  for (const p of packages) {
    const name = p.name.slice(0, LIMITS.serviceName);
    const price = p.price.slice(0, LIMITS.servicePrice) || null;
    const description = p.includes || null;
    const same = services.find((s) => s.name.trim().toLowerCase() === name.trim().toLowerCase());
    if (same) {
      await updateService(same.id, { price, description: description ?? same.description });
      updated++;
    } else if (services.length + added < 12) {
      await addService(b.id, name, price ?? undefined, description ?? undefined, services.length + added);
      added++;
    }
  }
  return `store updated: ${added} added, ${updated} updated`;
}

async function runTool(name: string, input: Record<string, unknown>, b: BusinessRow): Promise<string> {
  switch (name) {
    case "save_plan": {
      const plan = parsePlan({ ...b.plan, ...input });
      await updateBusinessPlan(b.id, plan);
      const left = missingForPlan(plan);
      return left.length ? `saved. still missing: ${left.join(", ")}` : "saved. plan complete";
    }
    case "send_to_store":
      return sendToStore(b);
    default:
      return "error: unknown tool";
  }
}

export async function runPlanChatTurn(opts: {
  business: BusinessRow;
  reload: () => Promise<BusinessRow>;
  history: { role: "user" | "assistant"; content: string }[];
  message: string;
  lang: Lang;
}): Promise<PlanChatResult> {
  let business = opts.business;
  const es = opts.lang === "es";
  const client = getClaude();
  if (!client) {
    console.error("[ai:plan] ANTHROPIC_API_KEY is not set");
    return {
      reply: es
        ? "El asistente no está disponible en este momento. Inténtalo de nuevo en unos minutos."
        : "The assistant isn't available right now. Please try again in a few minutes.",
      business,
    };
  }

  const system = `${SYSTEM}\n\nReply in ${es ? "Spanish (neutral, US Hispanic, 'tú')" : "English"}.`;
  const messages: MessageParam[] = [
    ...opts.history.map((h): MessageParam => ({ role: h.role, content: h.content })),
    { role: "user", content: `State (JSON):\n${JSON.stringify(await state(business))}\n\nOwner: ${opts.message}` },
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
          out = await runTool(u.name, (u.input ?? {}) as Record<string, unknown>, business);
        } catch (err) {
          console.error("[ai:plan] tool failed", u.name, err);
          out = "error: could not save";
        }
        business = await opts.reload();
        results.push({ type: "tool_result", tool_use_id: u.id, content: out });
      }
      messages.push({ role: "assistant", content: res.content });
      messages.push({
        role: "user",
        content: [...results, { type: "text", text: `Updated state (JSON):\n${JSON.stringify(await state(business))}` }],
      });
    }
  } catch (err) {
    logAiError("plan", err);
    reply = es
      ? "Tuve un problema para guardar eso. Inténtalo de nuevo en un momento."
      : "I had a problem saving that. Please try again in a moment.";
  }

  return { reply: reply || (es ? "Listo." : "Done."), business };
}

export function planGreeting(lang: Lang, b: BusinessRow): string {
  const es = lang === "es";
  if (b.plan.mode === "new" && b.plan.service) {
    return es
      ? `¡Hola! Soy el Cerebro de Sevrii. Vamos a convertir "${b.plan.service}" en un servicio que se venda: a quién, cómo y a qué precio. Para empezar: ¿qué cliente te imaginas comprándolo y en qué zona?`
      : `Hi! I'm Sevrii's Brain. Let's turn "${b.plan.service}" into a service that sells: to whom, how and at what price. To start: what customer do you picture buying it, and in what area?`;
  }
  return es
    ? `¡Hola! Soy el Cerebro de Sevrii. Antes de la página y los anuncios armamos la estrategia de ${b.name}: qué vender, a quién, cómo y a qué precio. Para empezar: ¿cuál es el servicio que más quieres vender con este proyecto?`
    : `Hi! I'm Sevrii's Brain. Before the page and the ads, we'll build ${b.name}'s strategy: what to sell, to whom, how and at what price. To start: which service do you most want to sell with this project?`;
}
