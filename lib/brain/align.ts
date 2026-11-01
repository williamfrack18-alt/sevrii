import { MODELS, getClaude, logAiError } from "../claude";
import type { Lang } from "../i18n";
import type { BusinessPlan } from "../plan";
import { textOf } from "./common";

// One correction, every part. When the owner corrects something ("cocino en
// mi cocina, no en la casa del cliente"), the edit the Brain made may fix one
// part and leave another saying the old thing (a step of "how it works", an
// FAQ, the video script). This pass reads the whole proposal against the
// correction and rewrites only the texts that still contradict it, so the
// owner never has to repeat the same correction. Prices and package names are
// never touched here.

const ALIGN = `Revisas una propuesta comercial después de una corrección del dueño. Tu única tarea: encontrar los textos que TODAVÍA contradicen la corrección y reescribirlos para que digan lo mismo que ella.
- Devuelve TODOS los campos del formato. En los que hay que cambiar, pon el texto (o la lista completa) corregido; en los que ya están de acuerdo con la corrección, pon "" (texto vacío) o [] (lista vacía). Vacío = no se toca.
- Revisa con cuidado cada paso de "steps", cada pregunta frecuente, cada paquete y el guion del video: ahí suele quedar lo viejo.
- No cambies nada más: ni el tono, ni datos, ni precios, ni nombres de paquetes. No agregues ofertas ni descuentos.
- Cambia lo mínimo: la frase que contradice, no el texto entero.
- Escribe en el mismo idioma de la propuesta.`;

const S = { type: "string" };
const LIST = { type: "array", items: { type: "string" } };
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    service: S,
    serviceIncludes: S,
    serviceExcludes: S,
    steps: LIST,
    customer: S,
    problem: S,
    promise: S,
    differentiators: LIST,
    pricingNote: S,
    videoScript: S,
    packages: {
      type: "array",
      description: "Same packages, same order, same names and prices: only includes/note may change",
      items: { type: "object", additionalProperties: false, properties: { includes: S, note: S }, required: ["includes", "note"] },
    },
    faq: { type: "array", items: { type: "object", additionalProperties: false, properties: { q: S, a: S }, required: ["q", "a"] } },
  },
  // Every field is present; an empty string or an empty list means "no change".
  required: ["service", "serviceIncludes", "serviceExcludes", "steps", "customer", "problem", "promise", "differentiators", "pricingNote", "videoScript", "packages", "faq"],
};

export async function alignProposal(plan: BusinessPlan, correction: string, lang: Lang): Promise<Record<string, unknown>> {
  const client = getClaude(40_000);
  if (!client || !correction.trim()) return {};
  const system = `${ALIGN}\n\n${lang === "es" ? "La propuesta está en español." : "The proposal is in English."}`;
  const content = `Corrección del dueño:\n${correction.slice(0, 1500)}\n\nPropuesta actual (JSON):\n${JSON.stringify({
    service: plan.service,
    serviceIncludes: plan.serviceIncludes,
    serviceExcludes: plan.serviceExcludes,
    steps: plan.steps,
    customer: plan.customer,
    problem: plan.problem,
    promise: plan.promise,
    differentiators: plan.differentiators,
    packages: plan.packages,
    pricingNote: plan.pricingNote,
    faq: plan.faq,
    videoScript: plan.videoScript,
  })}`;
  try {
    let d: Record<string, unknown>;
    try {
      const res = await client.messages.create(
        { model: MODELS.guard, max_tokens: 4000, output_config: { format: { type: "json_schema", schema: SCHEMA } }, system, messages: [{ role: "user", content }] },
        { timeout: 40_000, maxRetries: 1 }
      );
      d = JSON.parse(textOf(res.content)) as Record<string, unknown>;
    } catch (err) {
      // The schema can be refused (too complex for the API): the same request
      // as plain JSON in the text, so the correction still reaches every part.
      logAiError("align", err);
      const res = await client.messages.create(
        {
          model: MODELS.guard,
          max_tokens: 4000,
          system: `${system}\n\nResponde SOLO con un objeto JSON con estas claves: ${Object.keys(SCHEMA.properties).join(", ")}. Vacío = no se toca.`,
          messages: [{ role: "user", content }],
        },
        { timeout: 40_000, maxRetries: 1 }
      );
      const text = textOf(res.content);
      d = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as Record<string, unknown>;
    }
    const out: Record<string, unknown> = {};
    for (const k of ["service", "serviceIncludes", "serviceExcludes", "customer", "problem", "promise", "pricingNote", "videoScript"]) {
      if (typeof d[k] === "string" && (d[k] as string).trim()) out[k] = d[k];
    }
    for (const k of ["steps", "differentiators"]) if (Array.isArray(d[k]) && (d[k] as unknown[]).length) out[k] = d[k];
    if (Array.isArray(d.faq) && d.faq.length) out.faq = d.faq;
    // Packages: only what each one includes and its note; names and prices stay.
    if (Array.isArray(d.packages) && d.packages.length === plan.packages.length) {
      out.packages = plan.packages.map((p, i) => {
        const x = (d.packages as Record<string, unknown>[])[i] ?? {};
        return { ...p, includes: typeof x.includes === "string" && x.includes.trim() ? x.includes : p.includes, note: typeof x.note === "string" && x.note.trim() ? x.note : p.note };
      });
    }
    return out;
  } catch (err) {
    logAiError("align", err);
    return {};
  }
}
