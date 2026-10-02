import { MODEL, getClaude, CHAT_SETTINGS, logAiError } from "./claude";
import type { Lang } from "./i18n";
import type { Tool, MessageParam, ToolUseBlock, TextBlock } from "@anthropic-ai/sdk/resources/messages";
import {
  type BusinessRow,
  type ServiceRow,
  updateBusinessDetails,
  updateBusinessWhatsapp,
  updateBusinessAccent,
  addService,
  updateService,
  deleteService,
  listServices,
} from "./db";


// ---------- The one tool the model is allowed to call ----------
// Every field this tool can touch maps to a real column in Postgres. The
// model is never given a way to invent facts (photos, FAQ entries, reviews,
// ad accounts) — those simply aren't in this schema, so it can't "edit" them.
const EDIT_TOOL: Tool = {
  name: "apply_page_edits",
  description:
    "Apply one or more real edits to this business's Sevrii page. Only use this for changes covered by the fields below — never for things like uploading real photos, editing FAQ entries, managing reviews, or connecting ad accounts, since none of that exists in this schema yet.",
  input_schema: {
    type: "object",
    properties: {
      edits: {
        type: "array",
        items: {
          type: "object",
          properties: {
            op: {
              type: "string",
              enum: [
                "update_business",
                "update_whatsapp",
                "update_accent_color",
                "add_service",
                "update_service",
                "delete_service",
              ],
              description: "Which kind of edit this is.",
            },
            name: { type: "string", description: "New business name (update_business only)" },
            category: { type: "string", description: "New category (update_business only)" },
            description: {
              type: "string",
              description: "New short internal description of the business (update_business only)",
            },
            city: { type: "string", description: "New city/area served (update_business only)" },
            pitch: {
              type: "string",
              description: "New one-paragraph pitch shown on the public page (update_business only)",
            },
            whatsapp: { type: "string", description: "New WhatsApp number, e.g. +1 555 010 1234 (update_whatsapp only)" },
            accentColor: {
              type: "string",
              description: "New accent color as a 6-digit hex code like #122118 (update_accent_color only)",
            },
            serviceId: {
              type: "string",
              description: "Existing service's id, exactly as given in the current page data (update_service / delete_service only)",
            },
            serviceName: { type: "string", description: "Service name (add_service / update_service)" },
            servicePrice: { type: "string", description: "Service price text, e.g. 'From $85' (add_service / update_service)" },
            serviceDescription: { type: "string", description: "Service description (add_service / update_service)" },
          },
          required: ["op"],
        },
      },
    },
    required: ["edits"],
  },
};

type EditOp = {
  op: string;
  name?: string;
  category?: string;
  description?: string;
  city?: string;
  pitch?: string;
  whatsapp?: string;
  accentColor?: string;
  serviceId?: string;
  serviceName?: string;
  servicePrice?: string;
  serviceDescription?: string;
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

async function applyEdits(
  business: BusinessRow,
  services: ServiceRow[],
  edits: EditOp[]
): Promise<{ applied: string[]; skipped: string[]; business: BusinessRow; services: ServiceRow[] }> {
  const applied: string[] = [];
  const skipped: string[] = [];
  let nextBusiness = { ...business };
  let nextServices = [...services];

  for (const edit of edits) {
    try {
      switch (edit.op) {
        case "update_business": {
          const fields: Partial<{
            name: string;
            category: string;
            description: string;
            city: string | null;
            pitch: string;
          }> = {};
          if (edit.name !== undefined) fields.name = edit.name;
          if (edit.category !== undefined) fields.category = edit.category;
          if (edit.description !== undefined) fields.description = edit.description;
          if (edit.city !== undefined) fields.city = edit.city;
          if (edit.pitch !== undefined) fields.pitch = edit.pitch;
          if (Object.keys(fields).length === 0) {
            skipped.push("update_business: no fields given");
            break;
          }
          await updateBusinessDetails(business.id, fields);
          nextBusiness = { ...nextBusiness, ...fields } as BusinessRow;
          applied.push(`updated ${Object.keys(fields).join(", ")}`);
          break;
        }
        case "update_whatsapp": {
          if (!edit.whatsapp) {
            skipped.push("update_whatsapp: missing number");
            break;
          }
          await updateBusinessWhatsapp(business.id, edit.whatsapp);
          nextBusiness = { ...nextBusiness, whatsapp: edit.whatsapp };
          applied.push("updated WhatsApp number");
          break;
        }
        case "update_accent_color": {
          if (!edit.accentColor || !HEX_COLOR.test(edit.accentColor)) {
            skipped.push("update_accent_color: invalid hex color");
            break;
          }
          await updateBusinessAccent(business.id, edit.accentColor);
          nextBusiness = { ...nextBusiness, accentColor: edit.accentColor };
          applied.push(`updated accent color to ${edit.accentColor}`);
          break;
        }
        case "add_service": {
          if (!edit.serviceName) {
            skipped.push("add_service: missing name");
            break;
          }
          await addService(business.id, edit.serviceName, edit.servicePrice, edit.serviceDescription, nextServices.length);
          nextServices = await listServices(business.id);
          applied.push(`added service "${edit.serviceName}"`);
          break;
        }
        case "update_service": {
          if (!edit.serviceId) {
            skipped.push("update_service: missing serviceId");
            break;
          }
          const svc = nextServices.find((s) => s.id === edit.serviceId);
          if (!svc || svc.businessId !== business.id) {
            skipped.push("update_service: unknown service id");
            break;
          }
          const fields: Partial<{ name: string; price: string | null; description: string | null }> = {};
          if (edit.serviceName !== undefined) fields.name = edit.serviceName;
          if (edit.servicePrice !== undefined) fields.price = edit.servicePrice;
          if (edit.serviceDescription !== undefined) fields.description = edit.serviceDescription;
          if (Object.keys(fields).length === 0) {
            skipped.push("update_service: no fields given");
            break;
          }
          await updateService(edit.serviceId, fields);
          nextServices = nextServices.map((s) => (s.id === edit.serviceId ? { ...s, ...fields } : s));
          applied.push(`updated service "${svc.name}"`);
          break;
        }
        case "delete_service": {
          if (!edit.serviceId) {
            skipped.push("delete_service: missing serviceId");
            break;
          }
          const svc = nextServices.find((s) => s.id === edit.serviceId);
          if (!svc || svc.businessId !== business.id) {
            skipped.push("delete_service: unknown service id");
            break;
          }
          await deleteService(edit.serviceId);
          nextServices = nextServices.filter((s) => s.id !== edit.serviceId);
          applied.push(`deleted service "${svc.name}"`);
          break;
        }
        default:
          skipped.push(`unknown op: ${edit.op}`);
      }
    } catch (err) {
      console.error("[ai:editor] edit failed", edit.op, err);
      skipped.push(`${edit.op} failed`);
    }
  }

  return { applied, skipped, business: nextBusiness, services: nextServices };
}

export type EditorTurnResult = {
  reply: string;
  business: BusinessRow;
  services: ServiceRow[];
};

const SYSTEM_PROMPT = `You are Sevrii AI, helping the owner of a real, live business edit their real Sevrii page through this chat.

You can ONLY change what the apply_page_edits tool supports: business name, category, internal description, public pitch text, city, WhatsApp number, accent color, and services (add/update/delete, each with name, price, description).

Never invent facts about the business — only use what the owner tells you. If asked to do something outside those fields (uploading real photos, editing FAQ entries, managing reviews, connecting ad accounts, anything not listed above), say plainly and briefly that you can't do that yet. Don't pretend to.

When you do make a change, call apply_page_edits, then confirm in one short, concrete sentence what changed. Keep replies short.`;

function languageRule(lang: Lang): string {
  return lang === "es"
    ? "\n\nAlways write your replies in Spanish (neutral Latin American, using \"tú\"). Any text you save for the owner's page or campaign (names, pitch, service descriptions, ad copy, audience, budget notes) must also be in Spanish, unless the owner explicitly asks for another language."
    : "\n\nAlways write your replies in English. Any text you save for the owner's page or campaign must also be in English, unless the owner explicitly asks for another language.";
}

export async function runPageEditorTurn(
  business: BusinessRow,
  services: ServiceRow[],
  history: { role: "user" | "assistant"; content: string }[],
  instruction: string,
  lang: Lang = "en"
): Promise<EditorTurnResult> {
  const es = lang === "es";
  const system = SYSTEM_PROMPT + languageRule(lang);
  const client = getClaude();
  if (!client) {
    console.error("[ai:editor] ANTHROPIC_API_KEY is not set");
    return {
      reply: es
        ? "El editor con IA no está disponible en este momento. Inténtalo de nuevo en unos minutos."
        : "The AI editor isn't available right now. Please try again in a few minutes.",
      business,
      services,
    };
  }


  const stateBlock = JSON.stringify({
    business: {
      name: business.name,
      category: business.category,
      description: business.description,
      city: business.city,
      pitch: business.pitch,
      whatsapp: business.whatsapp,
      accentColor: business.accentColor,
    },
    services: services.map((s) => ({ id: s.id, name: s.name, price: s.price, description: s.description })),
  });

  const messages: MessageParam[] = [
    ...history.map((h): MessageParam => ({ role: h.role, content: h.content })),
    {
      role: "user",
      content: `Current page data:\n${stateBlock}\n\nInstruction: ${instruction}`,
    },
  ];

  let currentBusiness = business;
  let currentServices = services;
  let finalText = "";

  try {
    const first = await client.messages.create({
      model: MODEL,
      ...CHAT_SETTINGS,
      max_tokens: 2048,
      system,
      tools: [EDIT_TOOL],
      messages,
    });

    const toolUse = first.content.find((b): b is ToolUseBlock => b.type === "tool_use");

    if (toolUse && toolUse.name === "apply_page_edits") {
      const edits = ((toolUse.input as { edits?: EditOp[] }).edits ?? []) as EditOp[];
      const result = await applyEdits(currentBusiness, currentServices, edits);
      currentBusiness = result.business;
      currentServices = result.services;

      const second = await client.messages.create({
        model: MODEL,
      ...CHAT_SETTINGS,
        max_tokens: 1024,
        system,
        tools: [EDIT_TOOL],
        messages: [
          ...messages,
          { role: "assistant", content: first.content },
          {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: toolUse.id,
                content: JSON.stringify({ applied: result.applied, skipped: result.skipped }),
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
        finalText =
          result.applied.length > 0
            ? `${es ? "Listo" : "Done"} — ${result.applied.join("; ")}.`
            : es
              ? "No pude hacer ese cambio."
              : "I couldn't make that change.";
      }
    } else {
      finalText = first.content
        .filter((b): b is TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
    }
  } catch (err) {
    logAiError("editor", err);
    finalText = es
      ? "El editor con IA no está disponible en este momento. Inténtalo de nuevo en unos minutos."
      : "The AI editor isn't available right now. Please try again in a few minutes.";
  }

  return { reply: finalText || (es ? "Listo." : "Done."), business: currentBusiness, services: currentServices };
}
