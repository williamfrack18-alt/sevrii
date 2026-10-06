import { getClaude, logAiError, MODELS } from "./claude";
import {
  getBusinessById,
  listMarketplaceRows,
  listServices,
  setBusinessMarketCategory,
  setBusinessPublished,
  type BusinessRow,
  type ServiceRow,
} from "./db";
import { effectivePlan } from "./billing";
import { PLANS } from "./plans";

export { MARKET_CATEGORIES, MARKET_CATEGORY_EN, isMarketCategory, type MarketCategory } from "./marketCategories";
import { MARKET_CATEGORIES, isMarketCategory, type MarketCategory } from "./marketCategories";


// What each category covers, so the AI and the keyword fallback agree.
const GUIDE: Record<MarketCategory, string> = {
  "Finanzas y Crédito": "credit repair, loans, financing, taxes, bookkeeping, insurance",
  Mudanzas: "moving, hauling, junk removal, delivery, storage",
  "Hogar y Limpieza": "house cleaning, landscaping, lawn care, pest control, pool, pressure washing, home organizing, painting",
  "Belleza y Cuidado": "hair, barber, nails, makeup, lashes, spa, skincare, tattoo",
  Reparaciones: "handyman, plumbing, electrical, HVAC, roofing, appliance repair, construction, remodeling, EV charger installation, locksmith",
  "Legal y Trámites": "immigration paperwork, notary, document preparation, legal services",
  Eventos: "event planning, catering, DJ, decorations, party rentals, wedding services",
  Tecnología: "web design, IT support, phone or computer repair, software, social media management",
  "Salud y Bienestar": "personal training, nutrition, massage, therapy, home care, elderly care, yoga",
  Educación: "tutoring, classes, language lessons, music lessons, courses, driving school",
  Automotriz: "auto repair, mechanic, car detailing, towing, tires, body shop",
  Mascotas: "dog grooming, pet sitting, dog walking, pet training",
  Fotografía: "photography, video, drone, editing",
  "Asesoría y Negocios": "business consulting, marketing agency, coaching, any other professional service",
};

// Fallback when the AI isn't available. Text is lowercased without accents.
const KEYWORDS: [MarketCategory, RegExp][] = [
  ["Mascotas", /\b(pets?|dogs?|cats?|perros?|gatos?|mascotas?|canin[oa]s?|felin[oa]s?|grooming)\b/],
  ["Finanzas y Crédito", /\b(credito|credit|loans?|prestamos?|financ\w*|tax(es)?|impuestos?|contab\w*|bookkeep\w*|seguros?|insurance)\b/],
  ["Legal y Trámites", /\b(inmigracion|immigration|notar\w*|tramites?|paperwork|legal|abogad\w*)\b/],
  ["Fotografía", /\b(foto\w*|photo\w*|video\w*|drones?|filmacion\w*)\b/],
  ["Mudanzas", /\b(mudanzas?|moving|movers?|hauling|junk|acarreos?)\b/],
  ["Belleza y Cuidado", /\b(hair|barber\w*|unas|nails?|makeup|maquillaje|lash\w*|pestanas|spa|estetica|belleza|beauty|skin\w*|peluqueria)\b/],
  ["Reparaciones", /\b(plumb\w*|plomer\w*|electric\w*|electricista|hvac|aire acondicionado|roof\w*|techos?|handyman|reparacion\w*|repairs?|remodel\w*|construc\w*|cargador\w*|chargers?|locksmith|cerrajer\w*)\b/],
  ["Automotriz", /\b(autos?|cars?|carros?|coches?|mecanic\w*|mechanic\w*|detailing|towing|gruas?|llantas?|tires?)\b/],
  ["Hogar y Limpieza", /\b(clean\w*|limpieza|landscap\w*|jardin\w*|lawn|pest|plagas?|pools?|piscinas?|pressure|pintura|painting)\b/],
  ["Eventos", /\b(events?|eventos?|bodas?|weddings?|catering|dj|fiestas?|party|parties|decoracion\w*|quinceaneras?)\b/],
  ["Tecnología", /\b(web|software|it support|computer\w*|computador\w*|celulares?|phone repair|redes sociales|social media|tecnologia)\b/],
  ["Salud y Bienestar", /\b(fitness|trainer|entrenador\w*|nutri\w*|masajes?|massage|therap\w*|terapia\w*|home care|cuidado de adultos|yoga|salud|health)\b/],
  ["Educación", /\b(tutor\w*|clases?|lessons?|cursos?|courses?|idiomas?|languages?|music|musica|escuelas?|school)\b/],
];

function describe(b: BusinessRow, services: ServiceRow[]): string {
  return [b.name, b.category, b.plan.service, b.site.headline, b.pitch, ...services.slice(0, 6).map((s) => s.name)]
    .filter(Boolean)
    .join(" · ")
    .slice(0, 1200);
}

export function keywordCategory(text: string): MarketCategory {
  const t = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  for (const [cat, re] of KEYWORDS) if (re.test(t)) return cat;
  return "Asesoría y Negocios";
}

export async function classifyMarketCategory(b: BusinessRow, services: ServiceRow[]): Promise<MarketCategory> {
  const text = describe(b, services);
  const client = getClaude(20_000);
  if (client) {
    try {
      const res = await client.messages.create({
        model: MODELS.guard,
        max_tokens: 200,
        output_config: {
          format: {
            type: "json_schema",
            schema: {
              type: "object",
              properties: { category: { type: "string", enum: [...MARKET_CATEGORIES] } },
              required: ["category"],
              additionalProperties: false,
            },
          },
        },
        system: `Pick the ONE marketplace category that best fits this US service business, so customers browsing that category find it. Categories and what they cover:\n${MARKET_CATEGORIES.map((c) => `- ${c}: ${GUIDE[c]}`).join("\n")}`,
        messages: [{ role: "user", content: text }],
      } as never);
      const raw = (res as { content: { type: string; text?: string }[] }).content.find((c) => c.type === "text")?.text ?? "";
      const cat = (JSON.parse(raw) as { category?: unknown }).category;
      if (isMarketCategory(cat)) return cat;
    } catch (err) {
      logAiError("market-category", err);
    }
  }
  return keywordCategory(text);
}

// Publish or unpublish a page. Publishing also places it in the marketplace.
export async function publishBusiness(businessId: string, publish: boolean): Promise<BusinessRow> {
  await setBusinessPublished(businessId, publish);
  if (publish) {
    const b = (await getBusinessById(businessId))!;
    const category = await classifyMarketCategory(b, await listServices(businessId));
    await setBusinessMarketCategory(businessId, category);
  }
  return (await getBusinessById(businessId))!;
}

// ---------- What the marketplace shows ----------
export type MarketListing = {
  slug: string;
  name: string;
  title: string; // the main service or the page headline
  category: MarketCategory;
  location: string;
  price: string;
  logoUrl: string;
  coverUrl: string;
  spanish: boolean;
};

export async function marketplaceListings(): Promise<MarketListing[]> {
  const rows = await listMarketplaceRows();
  const out: MarketListing[] = [];
  for (const r of rows) {
    // Only owners whose plan still includes publishing (cancelled plans drop out).
    if (!PLANS[effectivePlan({ email: r.email, plan: r.plan ?? undefined, planStatus: r.planStatus ?? undefined })].limits.canPublish) continue;
    let category = r.marketCategory;
    if (!isMarketCategory(category)) {
      // Pages published before the marketplace existed: place them once by keywords.
      category = keywordCategory([r.name, r.category, r.site.headline, r.serviceName].filter(Boolean).join(" "));
      await setBusinessMarketCategory(r.id, category).catch(() => undefined);
    }
    const site = r.site;
    out.push({
      slug: r.slug,
      name: r.name,
      title: (r.serviceName || site.headline || r.name).slice(0, 90),
      category: category as MarketCategory,
      location: (site.serviceArea || r.city || "").slice(0, 60),
      price: (r.servicePrice || "").slice(0, 30),
      logoUrl: site.logoUrl || "",
      coverUrl: site.coverUrl || site.gallery[0] || "",
      spanish: site.spanish,
    });
  }
  return out;
}
