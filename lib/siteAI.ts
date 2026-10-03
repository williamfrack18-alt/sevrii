import { MODEL, getClaude, logAiError } from "./claude";
import type { Lang } from "./i18n";

// The AI writes a first draft of the store. It never invents facts the
// owner didn't give (licenses, insurance, years, reviews, guarantees,
// prices). The page starts as a draft and the owner reviews it before
// publishing.
export type SiteDraft = {
  headline: string;
  pitch: string;
  services: { name: string; description: string }[];
  highlights: string[];
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    headline: { type: "string", description: "Benefit-led headline, max 80 characters." },
    pitch: { type: "string", description: "2-3 sentence description for customers, max 320 characters." },
    services: {
      type: "array",
      description: "3 to 6 services this business plausibly offers, based only on what the owner said.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string", description: "Short service name, max 60 characters." },
          description: { type: "string", description: "One sentence, max 180 characters." },
        },
        required: ["name", "description"],
      },
    },
    highlights: {
      type: "array",
      description: "2 to 4 short reasons to choose this business, max 70 characters each, based only on what the owner said.",
      items: { type: "string" },
    },
  },
  required: ["headline", "pitch", "services", "highlights"],
} as const;

const RULES = `You write the first draft of a small US service business's one-page website, made to turn visitors into calls and messages.

Hard rules — the business owner is legally responsible for every claim, so:
- Use ONLY facts the owner gave. Never invent licenses, insurance, certifications, years in business, number of customers, reviews, ratings, awards, guarantees, warranties, "free" offers, discounts, response times, or prices.
- Never write "licensed", "insured", "certified", "guaranteed", "#1", "best", "top-rated", or "free estimate" unless the owner's own words say it.
- No phone numbers, emails or URLs.
- Plain, warm, specific language. Short sentences. Benefit first.
- Highlights describe how the owner works, taken from their description (e.g. "Bilingual service" only if they said they speak both languages).`;

function clip(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

const BANNED = /\b(licensed|insured|certified|guarantee[ds]?|#1|best in|top[- ]rated|free estimate|licenciad|asegurad|certificad|garantizad|el mejor|los mejores|presupuesto gratis|estimado gratis)\b/i;

export async function generateSiteDraft(input: {
  name: string;
  category: string;
  city: string;
  description: string;
  lang: Lang;
}): Promise<SiteDraft | null> {
  const client = getClaude();
  if (!client) return null;
  const language = input.lang === "es" ? "Spanish (neutral, US Hispanic audience, use 'tú')" : "English (US)";
  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 2500,
      thinking: { type: "between_tools" },
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA as unknown as Record<string, unknown> } },
      system: `${RULES}\n\nWrite everything in ${language}.`,
      messages: [
        {
          role: "user",
          content: `Business name: ${clip(input.name, 80)}\nType of business: ${clip(input.category, 60)}\nCity: ${clip(input.city, 80)}\nOwner's own description: ${clip(input.description, 1500)}`,
        },
      ],
    });
    const text = res.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("");
    const data = JSON.parse(text) as Partial<SiteDraft>;
    const clean = (s: string) => (BANNED.test(s) ? "" : s);
    const draft: SiteDraft = {
      headline: clean(clip(data.headline, 90)),
      pitch: clean(clip(data.pitch, 400)),
      services: (Array.isArray(data.services) ? data.services : [])
        .map((s) => ({ name: clean(clip(s?.name, 80)), description: clean(clip(s?.description, 240)) }))
        .filter((s) => s.name)
        .slice(0, 6),
      highlights: (Array.isArray(data.highlights) ? data.highlights : [])
        .map((h) => clean(clip(h, 80)))
        .filter(Boolean)
        .slice(0, 4),
    };
    if (!draft.pitch || draft.services.length === 0) return null;
    return draft;
  } catch (err) {
    logAiError("site-draft", err);
    return null;
  }
}
