import { MODELS, getClaude, logAiError } from "../claude";
import type { Lang } from "../i18n";
import { codeChecks, type BusinessPlan } from "../plan";
import { textOf, today } from "./common";

// The Guardian: a cheap model that flags problems before the owner sees a
// proposal. It never rewrites. Code checks run too, so a model failure never
// lets a fake claim through.

const GUARDIAN = `Eres el Guardián de Sevrii. Revisas una propuesta antes de mostrarla. No reescribes nada: marcas problemas.

Marca como "block":
- Afirmaciones sin respaldo en el expediente: licencia, seguro, años, garantías, "el mejor", cifras de clientes o reseñas.
- Promesas de ingresos, resultados o tiempos que nadie puede asegurar.
- Urgencia falsa u ofertas sin fecha real.
- Un oficio que pide licencia en ese estado cuando el dueño no la tiene.
- Servicios de alto riesgo sin licencia: reparación de crédito, asesoría legal o migratoria ("notario"), préstamos, servicios médicos.

Marca como "warn":
- Categorías especiales de anuncios de Meta: crédito, empleo, vivienda, productos financieros.
- Precios muy por debajo o por encima del rango de la zona.
- Textos que preguntan por rasgos personales ("¿Eres latino?", "¿Tienes deudas?").

La oferta todavía es una sugerencia sin fecha: el dueño pondrá la fecha de fin real antes de aprobar. No la marques por no tener fecha.

Cada punto: el campo y la razón en una línea. Si no hay problemas, listas vacías.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: { block: { type: "array", items: { type: "string" } }, warn: { type: "array", items: { type: "string" } } },
  required: ["block", "warn"],
};

const CODE_TEXT: Record<string, { es: string; en: string }> = {
  claim: { es: "Hay una afirmación que necesita prueba (garantizado, el mejor, número de clientes o reseñas).", en: "A claim needs proof (guaranteed, the best, customer or review counts)." },
  offer: { es: "La oferta necesita una fecha de fin real y que no haya pasado.", en: "The offer needs a real end date that hasn't passed." },
  license: { es: "Este oficio pide licencia estatal y todavía no la tienes.", en: "This trade needs a state license you don't have yet." },
  restricted: { es: "Este tipo de servicio necesita una revisión de Sevrii antes de publicarse.", en: "This kind of service needs a Sevrii review before publishing." },
};

export function codeGuard(plan: BusinessPlan, lang: Lang, final = true): { block: string[]; warn: string[] } {
  const raw = codeChecks(plan, today(), final);
  const keys = [...new Set(raw.block.map((b) => b.split(":")[0]))];
  return { block: keys.map((k) => (CODE_TEXT[k] ? CODE_TEXT[k][lang] : k)), warn: [] };
}

export async function guardPlan(plan: BusinessPlan, lang: Lang): Promise<{ block: string[]; warn: string[] }> {
  const fromCode = codeGuard(plan, lang, false);
  const client = getClaude(40_000);
  if (!client) return fromCode;
  try {
    const res = await client.messages.create({
      model: MODELS.guard,
      max_tokens: 1500,
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      system: `${GUARDIAN}\n\nEscribe cada punto en ${lang === "es" ? "español neutro" : "English"}, para el dueño del negocio.`,
      messages: [
        {
          role: "user",
          content: `Expediente (JSON):\n${JSON.stringify({ profile: plan.profile, market: { prices: plan.market.prices, requirements: plan.market.requirements } })}\n\nPropuesta (JSON):\n${JSON.stringify({
            service: plan.service,
            promise: plan.promise,
            differentiators: plan.differentiators,
            packages: plan.packages,
            offer: plan.offer,
            campaignType: plan.campaignType,
            faq: plan.faq,
          })}`,
        },
      ],
    });
    const d = JSON.parse(textOf(res.content)) as { block?: unknown; warn?: unknown };
    const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x).slice(0, 240)).filter(Boolean).slice(0, 6) : []);
    return { block: [...fromCode.block, ...list(d.block)], warn: list(d.warn) };
  } catch (err) {
    logAiError("guard", err);
    return fromCode;
  }
}
