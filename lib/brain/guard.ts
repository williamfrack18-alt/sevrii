import { MODELS, getClaude, logAiError } from "../claude";
import type { Lang } from "../i18n";
import { codeChecks, type BusinessPlan } from "../plan";
import { textOf, today } from "./common";

// The Guardian: a cheap model that flags problems before the owner sees a
// proposal. It never rewrites. Code checks run too, so a model failure never
// lets a fake claim through.

const GUARDIAN = `Eres el Guardián de Sevrii. Revisas una propuesta antes de mostrarla. No reescribes nada: marcas problemas.

Marca como "block":
- Afirmaciones sin respaldo en el expediente: licencia, seguro, años, garantías, "el mejor", cifras de clientes o reseñas. Lo que dice la investigación del mercado (competencia y huecos) SÍ cuenta como respaldo.
- No marques plazos de entrega o de trabajo que el dueño se compromete a cumplir con su propio trabajo; solo marca promesas de resultados que nadie controla (ingresos, clientes, "garantizado").
- Promesas de ingresos, resultados o tiempos que nadie puede asegurar.
- Urgencia falsa ("solo hoy", "últimos cupos" sin prueba).
- Servicios de alto riesgo: reparación de crédito, asesoría legal o migratoria ("notario"), préstamos, servicios médicos.
- Idiomas: decir que atiende en un idioma que el dueño no dijo (el perfil dice "languages": es = solo español, en = solo inglés, both = los dos). Nunca "bilingüe" si no es "both".
- Usar como argumento de venta algo que el dueño dijo que NO quiere hacer o que le cuesta ("notWant" o lo que dijo en la entrevista): un límite del dueño es sagrado.
- Nombrar a un negocio real con un precio que no está en la investigación (market.competitors con su precio). Si no está ahí, no se cita.
- Políticas que el dueño no dio: reembolsos, cancelaciones, depósitos, garantías o plazos de pago. En las preguntas frecuentes se responde "escríbenos por el chat y lo vemos contigo", no se inventa una política.
- Suponer que el dueño ya tiene video, fotos, reseñas, licencia o seguro si el perfil no lo dice.
- Precios que no cuadran entre sí: un monto en la promesa, la oferta o las notas que no corresponde a ningún paquete, o paquetes con rangos que se pisan.
- Cuentas de costos que no suman bien.
- Cambiar el precio que el dueño cobra hoy (profile.currentPrice) sin su OK: si el paquete de su servicio de hoy cobra otro precio, o hay un nivel nuevo que no está marcado como "Sugerido:".
- Decir que un precio está "en el rango", "por debajo" o "por encima" del mercado cuando los números de market.prices dicen otra cosa.
- Datos que nadie dio: tareas que el dueño no mencionó, herramientas, cuentas o perfiles que no dijo tener ("tu perfil de Google"), impuestos, cargos extra o depósitos.
- Ofrecer o sugerir algo que el dueño excluyó (por ejemplo, agregar inglés cuando dijo solo español).

Marca como "warn":
- Categorías especiales de anuncios de Meta (lista oficial: productos financieros y crédito; empleo; vivienda; temas sociales, elecciones o política). Meta incluye dentro de vivienda las reparaciones de vivienda ("housing repairs"): plomería, electricidad, techos o remodelación PUEDEN caer ahí; dilo como "puede aplicar, Meta lo confirma al crear el anuncio", nunca como seguro. Limpieza, mudanzas, jardinería, lavandería, belleza, barbería, armado de muebles y clases NO son categoría especial: no los marques.
- Comparar cosas distintas: un precio por paquete contra un precio por hora (o por pie², por visita). Si comparas, usa la misma unidad (convierte el paquete a precio por hora con las horas que dura).
- Precios muy por debajo o por encima del rango de la zona.
- Textos que preguntan por rasgos personales ("¿Estás divorciado?", "¿Tienes deudas?").

Ofertas: NUNCA marques una oferta por no tener fecha de fin. Una oferta de bienvenida para clientes nuevos (forNewClients = true) no lleva fecha, y en una promoción por tiempo limitado el dueño pone la fecha antes de aprobar.

Cómo escribes cada punto:
- Para el dueño del negocio, en palabras sencillas, como se lo dirías en persona.
- Nunca uses nombres técnicos de campos (nada de "offer.detail", "packages[0]", "forNewClients", "endsAt", "insured").
- Una sola frase corta, máximo 180 caracteres.
Si no hay problemas, listas vacías.`;

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
  promise: { es: "Hay una frase que promete un resultado que nadie puede asegurar.", en: "A sentence promises a result nobody can guarantee." },
  lang: { es: "La propuesta dice que atiendes en un idioma que no me dijiste. Debe usar solo el idioma (o los idiomas) en que atiendes.", en: "The proposal says you serve in a language you didn't tell me. It must use only the language(s) you serve in." },
};

export function codeGuard(plan: BusinessPlan, lang: Lang, final = true): { block: string[]; warn: string[] } {
  const raw = codeChecks(plan, today(plan.profile.state), final);
  const keys = [...new Set(raw.block.map((b) => b.split(":")[0]))];
  return { block: keys.map((k) => (CODE_TEXT[k] ? CODE_TEXT[k][lang] : k)), warn: [] };
}

// The price the owner charges today stays in the proposal as they said it: a
// different one is only a suggestion they approve in the chat. Checked by code
// on the first proposal only (once they agree to a change in the chat, the new
// price is theirs). Hourly or per-unit prices aren't compared with packages.
const money = (t: string) => [...t.matchAll(/\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?/g)].map((m) => Number(m[1].replace(/,/g, "")));
export function keptPriceIssue(plan: BusinessPlan, lang: Lang): string | null {
  const cp = plan.profile.currentPrice || "";
  if (!cp || !plan.packages.length || /(hora|hour|\/\s?h(r|ra)?\b|pie|sq\.?\s?ft|milla|mile)/i.test(cp)) return null;
  const now = [...new Set(money(cp).filter((n) => n >= 5))];
  if (!now.length || now.length > 4) return null;
  const offered = new Set(plan.packages.flatMap((k) => money(k.price)));
  const lost = now.filter((n) => !offered.has(n));
  if (!lost.length) return null;
  const list = lost.map((n) => `$${n}`).join(", ");
  return lang === "es"
    ? `Hoy cobras ${list} y ningún paquete mantiene ese precio. Tu precio se queda como lo dijiste; si te propongo otro, te pido el OK primero.`
    : `Today you charge ${list} and no package keeps that price. Your price stays as you said it; if I suggest another one, I ask for your OK first.`;
}

export async function guardPlan(plan: BusinessPlan, lang: Lang): Promise<{ block: string[]; warn: string[] }> {
  const code = codeGuard(plan, lang, false);
  const kept = keptPriceIssue(plan, lang);
  const fromCode = { ...code, block: kept ? [...code.block, kept] : code.block };
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
          content: `Expediente (JSON):\n${JSON.stringify({
            profile: plan.profile,
            market: {
              prices: plan.market.prices,
              requirements: plan.market.requirements,
              gaps: plan.market.gaps,
              competitors: plan.market.competitors.map((c) => ({ name: c.name, offer: c.offer, price: c.price, guarantee: c.guarantee, languages: c.languages })),
            },
          })}\n\nPropuesta (JSON):\n${JSON.stringify({
            service: plan.service,
            serviceIncludes: plan.serviceIncludes,
            steps: plan.steps,
            promise: plan.promise,
            differentiators: plan.differentiators,
            packages: plan.packages,
            pricingNote: plan.pricingNote,
            offer: plan.offer,
            campaignType: plan.campaignType,
            faq: plan.faq,
          })}`,
        },
      ],
    });
    const d = JSON.parse(textOf(res.content)) as { block?: unknown; warn?: unknown };
    const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x).trim().slice(0, 240)).filter(Boolean).slice(0, 6) : []);
    // Dates on offers are checked by code (codeChecks), never by the model:
    // a welcome offer has none, and a time-limited one gets its date on approval.
    const aboutOfferDate = (s: string) => /(fecha|date|endsAt|vencimiento|vence|expir|forNewClients)/i.test(s) && /(oferta|offer|descuento|discount|promo)/i.test(s);
    return { block: [...fromCode.block, ...list(d.block).filter((s) => !aboutOfferDate(s))], warn: list(d.warn).filter((s) => !aboutOfferDate(s)) };
  } catch (err) {
    logAiError("guard", err);
    return fromCode;
  }
}
