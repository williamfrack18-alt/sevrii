import Anthropic from "@anthropic-ai/sdk";
import type { Tool, MessageParam, ToolUseBlock, TextBlock } from "@anthropic-ai/sdk/resources/messages";
import { type BusinessRow, type ServiceRow, type CampaignRow, createCampaign } from "./db";

// Overridable so this doesn't go stale if Anthropic's model lineup moves on;
// "claude-sonnet-4-5" is a rolling alias that always points at a current,
// non-deprecated Sonnet model.
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

// ---------- The one tool the model is allowed to call ----------
// This always produces a complete, ready-to-use campaign draft in a single
// turn — the model should build it directly from what it already knows
// about the business (category, city, services) rather than interviewing
// the owner field by field first, the same way the page editor agent
// applies edits directly instead of asking permission for each one.
//
// It can NEVER publish anything or spend real money: Sevrii isn't connected
// to any ad account yet, so every campaign this creates stays a "draft" the
// owner would still have to launch manually themselves, on whatever
// platform they choose.
const CAMPAIGN_TOOL: Tool = {
  name: "create_campaign",
  description:
    "Save one complete draft ad campaign for this business. This never publishes anything or spends real money — there is no ad account connected. Build a full, ready-to-use plan in one call: don't ask clarifying questions first unless the request is truly too vague to act on at all.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short internal name for this campaign" },
      goal: { type: "string", description: "The business outcome this is for, e.g. 'more WhatsApp bookings this month'" },
      audience: {
        type: "string",
        description:
          "Who this should target: age range, location/radius, interests — grounded in the business's real city and category, not invented demographics data.",
      },
      platforms: {
        type: "string",
        description: "Where to run it, e.g. 'Meta (Facebook + Instagram)' or 'Google Search'",
      },
      budgetNote: {
        type: "string",
        description: "Suggested budget and duration, e.g. '$10-15/day for the first two weeks, then reassess'",
      },
      variations: {
        type: "array",
        minItems: 2,
        maxItems: 3,
        items: {
          type: "object",
          properties: {
            headline: { type: "string" },
            body: { type: "string" },
          },
          required: ["headline", "body"],
        },
        description: "2-3 distinct ad copy variations to test against each other",
      },
    },
    required: ["title", "goal", "audience", "platforms", "budgetNote", "variations"],
  },
};

type CampaignToolInput = {
  title: string;
  goal: string;
  audience: string;
  platforms: string;
  budgetNote: string;
  variations: { headline: string; body: string }[];
};

export type MarketingTurnResult = {
  reply: string;
  campaign: CampaignRow | null;
};

const SYSTEM_PROMPT = `You are Sevrii's marketing agent, helping the owner of a real, live business plan advertising for it.

When the owner describes what they want (more bookings, more calls, promote a new service, a slow week, anything like that), build ONE complete, ready-to-launch campaign draft in this single turn by calling create_campaign — audience, platforms, a budget suggestion, and 2-3 ad copy variations. Act the way an experienced local marketer would: make sensible, concrete decisions yourself from the business's real category, city and services, exactly like Sevrii's page-editor agent applies edits directly instead of asking permission for each field. Don't interview the owner with a list of clarifying questions before doing anything.

You can ONLY produce a draft. Sevrii is not connected to any ad account, so never say or imply the campaign is live, published, or already spending money, and never invent performance numbers, follower counts, or past results — those don't exist yet.

Only skip the tool call and ask a short clarifying question instead when the message is genuinely too vague to act on at all (e.g. just "hi" or "test"). Otherwise always call create_campaign exactly once, then confirm in one or two short sentences what you built.`;

export async function runMarketingAgentTurn(
  business: BusinessRow,
  services: ServiceRow[],
  history: { role: "user" | "assistant"; content: string }[],
  instruction: string
): Promise<MarketingTurnResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      reply:
        "The AI marketing agent isn't turned on yet — add an ANTHROPIC_API_KEY in this project's Vercel Environment Variables to enable it.",
      campaign: null,
    };
  }

  const client = new Anthropic({ apiKey });

  const stateBlock = JSON.stringify({
    business: {
      name: business.name,
      category: business.category,
      city: business.city,
      pitch: business.pitch,
    },
    services: services.map((s) => ({ name: s.name, price: s.price, description: s.description })),
  });

  const messages: MessageParam[] = [
    ...history.map((h): MessageParam => ({ role: h.role, content: h.content })),
    {
      role: "user",
      content: `Business data:\n${stateBlock}\n\nOwner's request: ${instruction}`,
    },
  ];

  let campaign: CampaignRow | null = null;
  let finalText = "";

  try {
    const first = await client.messages.create({
      model: MODEL,
      max_tokens: 1536,
      system: SYSTEM_PROMPT,
      tools: [CAMPAIGN_TOOL],
      messages,
    });

    const toolUse = first.content.find((b): b is ToolUseBlock => b.type === "tool_use");

    if (toolUse && toolUse.name === "create_campaign") {
      const input = toolUse.input as CampaignToolInput;
      campaign = await createCampaign({
        businessId: business.id,
        title: input.title,
        goal: input.goal,
        audience: input.audience,
        platforms: input.platforms,
        budgetNote: input.budgetNote,
        adCopy: input.variations?.[0]?.body,
        variations: JSON.stringify(input.variations ?? []),
      });

      const second = await client.messages.create({
        model: MODEL,
        max_tokens: 512,
        system: SYSTEM_PROMPT,
        tools: [CAMPAIGN_TOOL],
        messages: [
          ...messages,
          { role: "assistant", content: first.content },
          {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: toolUse.id,
                content: JSON.stringify({ saved: true, campaignId: campaign.id }),
              },
            ],
          },
        ],
      });

      finalText = second.content
        .filter((b): b is TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      if (!finalText) {
        finalText = `Done — I put together "${campaign.title}" as a draft campaign. Take a look below.`;
      }
    } else {
      finalText = first.content
        .filter((b): b is TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
    }
  } catch (err) {
    finalText = `Something went wrong talking to the marketing agent: ${err instanceof Error ? err.message : String(err)}`;
  }

  return { reply: finalText || "Done.", campaign };
}
