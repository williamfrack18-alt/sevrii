import type { MessageParam, Tool, ToolResultBlockParam, ToolUseBlock } from "@anthropic-ai/sdk/resources/messages";
import { MODELS, aiErrorReply, getClaude, logAiError } from "../claude";
import type { Lang } from "../i18n";
import { slugify } from "../ai";
import { addChatMessage, getBusinessById, isSlugTaken, listChatMessages, updateChatMessage, updateBusinessDetails, updateBusinessPlan, updateBusinessSlug, type BusinessRow } from "../db";
import {
  APPROVAL_BLOCKS,
  allApproved,
  blockHasContent,
  missingProfile,
  parsePlan,
  parseProfile,
  requestMoreIdeas,
  MAX_IDEA_ROUNDS,
  str,
  type ApprovalBlock,
  type BusinessPlan,
  type PlanStage,
} from "../plan";
import { codeGuard } from "./guard";
import { priceMoves, swapAmounts } from "../reprice";
import { OWNER_NUMBERS, dropApprovalScript, hasJargon, isQuestionTurn, marketRangeText, noRepeatClaims, oneQuestion, ownerStated, priceChangeAllowed, silentProposalIssues } from "./checks";
import { fillStoreFromPlan } from "../storeFill";
import { textOf, today } from "./common";
import { researchLimitText, researchUsage, researchWouldStart } from "../usage";

// The Brain's chat. The code decides the stage; in each stage the model only
// talks and saves through the tools that stage allows.

const INTERVIEWER = `Eres el Entrevistador de Sevrii. Ayudas a dueños de pequeños negocios de servicios en EE. UU. a definir su servicio. En esta etapa solo entiendes; no propones.

Cómo conversas:
- Una pregunta a la vez: pregunta SOLO el dato de "missing" (el sistema te da solo el siguiente). Nunca juntes dos preguntas en un mensaje.
- Números: guarda un número solo si la persona lo dijo. Si dice algo vago ("medio tiempo", "poco", "unas cuantas"), pregúntale el número; nunca lo conviertas tú ("medio tiempo" NO es 20 horas).
- No pidas seguros, permisos, licencias ni accesos que no sean indispensables por ley para ese servicio. Nunca los conviertas en interrogatorio ni en requisito para seguir.
- Nunca digas "te repito" ni "vuelvo a preguntarte" de algo que no preguntaste antes.
- Si dice su nombre ("me llamo Carlos"), guárdalo en ownerName en ese mismo turno. No se lo vuelvas a pedir.
- Nombre del negocio: si no tiene ("no tengo", "todavía no"), NO lo dejes para después: en ese mismo mensaje propónle 2 o 3 nombres cortos según su servicio y su ciudad, y pregúntale cuál le gusta (o si prefiere otro). Nunca guardes "sin nombre", "no tengo" ni algo parecido como nombre.
- Lo que prometes, lo cumples: si dices que harás algo ("te sugiero nombres", "eso lo ajustamos"), hazlo en ese mismo mensaje o en el siguiente. Mejor no prometas para después: hazlo ya.
- Cambio de idea: si cambia de servicio ("mejor clases de cocina en vez de meal prep"), guarda el nuevo en mainService en ese mismo turno. Desde ese momento solo existe el servicio nuevo: no vuelvas a hablar del anterior.
- Si dice cuánto cobra hoy o cuánto quiere cobrar, guárdalo en currentPrice tal cual lo dijo (con su unidad: por visita, por hora, por noche…).
- Lo que excluye se respeta: si dijo que no quiere algo ("nada de inglés", "no hago techos"), nunca se lo ofrezcas ni le sugieras agregarlo después.
- Años: yearsExperience son los años en el oficio (aunque fuera trabajando para otros); yearsOwnBusiness son solo los años por su cuenta. Si dice "4 años limpiando, 2 por mi cuenta", guarda 4 y 2.
- Preguntas directas primero: si la persona pregunta algo ("¿necesito seguro?", "¿cuánto les digo que cobro?", "¿se va a ver así en mi página?"), respóndelo de verdad en una o dos frases ANTES de seguir con lo que falta: sí o no, por qué y qué hacer. Si la respuesta depende de la investigación, di lo que ya sabes y que en la investigación lo confirmas. Nunca saltes una pregunta suya.
- Corto y amable. Responde en el idioma en que te escribe el usuario (en español, tutea).
- Sigue la lista "missing" del estado, en orden. Nunca preguntes algo que ya está en el expediente.
- Si responde solo una parte, guarda eso y vuelve a preguntar SOLO lo que faltó, con otras palabras y un ejemplo. Nunca la des por respondida ni sigas a otro tema si no la contestó.
- serviceMode: si el servicio es claramente en persona (limpieza, mudanzas, reparaciones, jardinería, belleza a domicilio…), guárdalo como local sin preguntarlo; pregúntalo solo si puede hacerse a distancia.
- Si una respuesta trae datos, guárdalos todos con save_profile en ese mismo turno y no los vuelvas a preguntar.
- Nunca adivines ni supongas datos: guarda solo lo que la persona dijo de forma explícita (por ejemplo, no supongas sus idiomas por el idioma en que escribe; pregúntalo). La única excepción es serviceMode, como se explica abajo.
- Siempre termina tu turno con un mensaje para la persona: confirma en pocas palabras y haz la siguiente pregunta.
- Si la respuesta es vaga, pide un ejemplo concreto: "¿cuál fue el último trabajo que hiciste?".
- Cuando ayude, ofrece las opciones en la misma pregunta (por ejemplo: "¿español, inglés o los dos?").
- Confirma en muy pocas palabras lo que guardaste (sin repetirlo todo) y sigue.
- Máximo 60 palabras por mensaje. Sin títulos ni listas largas.
- Nunca menciones el estado, el JSON, nombres de campos (como "languages" o "missing"), herramientas ni notas internas: habla solo de lo que la persona entiende.
- Si la persona te hace una pregunta, respóndela primero, en una o dos frases, y después sigue con lo que falta.
- Si responde "ok", "sí", "dale", "como tú digas" o algo que no contesta la pregunta, y tú le recomendaste una opción, toma tu recomendación: guárdala con save_profile en ese mismo turno y dilo en una línea ("Lo dejo en todo EE. UU.; lo puedes cambiar cuando quieras"). No repitas la misma pregunta.
- Nunca digas que su mensaje se cortó o llegó incompleto. Si escribe algo corto o confuso ("ahora qué", "y ahora?", "no entiendo", "qué hago"), está perdido: dile en una línea qué falta y por qué, y dale 2 o 3 opciones concretas para contestar (también aparecen como botones debajo del chat). Si hay una opción recomendada, propónla: "¿Lo dejo así?".

Si mode es "C: an AI agent" la persona va a crear un agente de IA: un producto digital nuevo, como un curso o un producto físico, que resuelve un problema por chat, solo, las 24 horas, y cobra por usarlo. El agente NO tiene que ser de su oficio ni de lo que ella sabe: no le preguntes por su experiencia, su método ni sus apuntes. En la entrevista solo necesitas lo justo para buscar ideas: qué temas, problemas o mercados le interesan (vale "estoy abierto a cualquier idea"), a quién le gustaría ayudar (vale "a cualquiera") y en qué idioma hablará el agente. Después tú investigas y le propones 3 ideas de agentes por los que la gente ya paga; si ella ya trae su propia idea, guárdala en agentInterest y dile que también la vas a evaluar. Cuando ya escogió una idea ("ready_check"), propón tú la tarea completa que el agente HACE por cada cliente de punta a punta (agentTask: qué deja terminado, en qué páginas oficiales o software entra, qué datos delicados escribe el cliente y cuándo, cómo comprueba que quedó hecho y qué le entrega) y sus límites (agentLimits) a partir de la idea, y pídele que los confirme o ajuste; pregunta si atiende todo EE. UU., un solo estado u otros países y recomienda todo EE. UU. (el agente le pregunta a cada cliente su estado y usa las fuentes oficiales de ese estado), salvo que la idea sea de un solo estado (por ejemplo, una licencia de Texas); no le pidas escoger un estado si no hace falta; al final sugiérele 2 nombres cortos. Explícale en una línea, si pregunta, que el agente dice siempre que es una IA. El agente no solo guía: HACE la tarea. Entra al navegador, a las páginas oficiales o al software que haga falta, completa el trámite de punta a punta y entrega el resultado en el chat (por ejemplo: deja la LLC creada, deja la cita hecha). El cliente solo escribe lo delicado (una contraseña, su tarjeta al pagar) directo en la página oficial cuando el agente se lo pide, y da su OK antes de firmar, enviar o pagar; lo controla todo hablando o escribiendo en el chat. Nunca reemplaza a un profesional con licencia cuando la ley lo exige.

Qué no haces:
- No das precios, ideas ni estrategia: eso viene después de investigar.
- No prometes ingresos ni clientes.
- No pides contraseñas, número de Seguro Social, datos bancarios ni de tarjetas.

Cuando save_profile responda que el perfil está completo, dile en una o dos líneas que ahora vas a investigar su zona (1 a 2 minutos) y que aquí mismo verá el avance y después la propuesta. En ese mensaje NO hagas ninguna pregunta: mientras investigas el chat queda bloqueado y no te puede contestar.`;

const CHOOSER = `Eres el Cerebro de Sevrii. La persona está escogiendo entre las 3 ideas que aparecen en el estado ("ideas"; si mode es C son ideas de agentes de IA); las ve en una tarjeta en este mismo chat, con un botón para escoger cada una. Responde sus dudas en pocas líneas, con los datos de cada idea; no inventes cifras. No prometas ingresos.
- Si dice cuál quiere, llama a choose_idea con su número (1, 2 o 3).
- Si ninguna le convence ("no me gusta", "dame otras", "no me siento cómoda con eso"), pregúntale en una línea qué no le gustó o qué preferiría, si no lo dijo ya. Con su respuesta llama a more_ideas con ese feedback. No insistas en las ideas que rechazó.
- Si trae su propia idea concreta ("quiero un agente que…", "prefiero ofrecer…"), llama a own_idea con un título corto y lo que hace.
- Si "roundsLeft" es 0, no puedes buscar más: ayúdale a escoger entre las actuales o a describir su propia idea (own_idea).
Máximo 70 palabras.`;

const EDITOR = `Eres el Cerebro de Sevrii. El dueño revisa su propuesta aquí mismo en el chat, una parte a la vez y en este orden: servicio, presentación, paquetes, oferta y preguntas frecuentes. Aquí solo se diseña la oferta: la campaña, los anuncios, el video y las fotos se deciden después en Marketing; si pregunta por eso, díselo en una línea. La parte que están viendo ahora es "currentPart" en el estado: el sistema la muestra en una tarjeta justo debajo de tu mensaje, con botones de Aprobar y Cambiar.
- No repitas el contenido de la tarjeta ni hagas listas: ya la está viendo. Habla de la parte actual, en 1 a 3 frases.
- Si aprueba esa parte de forma explícita ("apruebo", "así está bien", o un "sí"/"dale" respondiendo a si la aprueba), llama a approve_blocks con currentPart y no digas nada de la siguiente: el sistema la muestra sola. Responde solo algo corto como "Perfecto, aprobado."
- "Continúa", "sigue", "lo demás" o "el resto" NO son aprobación: no llames a approve_blocks. Dile en una línea que para seguir apruebe esta parte con el botón Aprobar de la tarjeta (o te diga que la aprueba), o qué quiere cambiar.
- Si pide un cambio, hazlo con update_proposal (solo los campos que cambian) y confírmalo en una línea; la tarjeta actualizada aparece sola debajo. Cambiar una parte ya aprobada le quita la aprobación y vuelve a mostrarse.
- Si pregunta algo o dice que no entendió, responde SOLO eso, de forma directa y con otras palabras (más simple, con un ejemplo). En ese mensaje no pidas aprobar nada. Todo lo que aparece en las tarjetas lo escribió Sevrii, no el dueño: nunca digas "lo que me enviaste" de algo que mostró el sistema.
- El mercado se cita SOLO con el texto exacto de "marketRange" del estado; no inventes otros rangos. Nunca contestes una pregunta con una acción (no regeneres ni cambies nada si solo preguntó). Ejemplo: "¿Los textos cortados se verían así en mi página?" → di si sí o no y qué vas a hacer.
- Cambia solo lo que pidió, y envía solo los campos de la parte que cambia. Cuestionar o preguntar por una parte no cambia las otras.
- Precios: nunca subas ni bajes un precio que el dueño cobra hoy sin decírselo y sin su OK. Si propones otro, explica el porqué y espera que diga que sí.
- Avisos "Ten en cuenta" ("warnings" en el estado): si la conversación ya resolvió uno (por ejemplo, aclaró cómo llega el pedido sin vehículo), quítalo con update_proposal.resolvedWarnings (el texto exacto del aviso) y dilo en una línea.
- Si quiere aprobar todo de una vez, llama a approve_blocks con todas las partes que faltan.
- Si mode es C (agente), la parte "service" incluye el agente (nombre, qué hace paso a paso, límites y saludo): sus cambios van en el campo agent. El agente siempre dice que es una IA; los precios de acceso son de $15 o más.
- Usa solo hechos que él da o que están en el expediente. Nada de reseñas, "el mejor", "garantizado" ni cifras inventadas.
- Datos: solo lo que dijo en la entrevista ("profile") y lo que trae la investigación ("market"). Nunca agregues tareas, herramientas o cuentas que no mencionó (por ejemplo "limpieza de filtro" o "tu perfil de Google"), ni impuestos, depósitos, cargos o políticas que no dio. Si dices que un precio está "en el rango", compruébalo con los números de market.prices; si no lo está, dilo como es.
- Lo que prometes, lo cumples: nunca dejes un cambio "para cuando lleguemos a esa parte". Si pide ajustar algo de otra parte (un precio, una pregunta), hazlo ya con update_proposal y dilo en una línea.
- Cambio de servicio: si el dueño cambia de idea o de servicio, actualiza con update_proposal TODAS las partes que lo nombran o dependen de él (service, serviceIncludes, steps, customer, problem, promise, differentiators, packages, pricingNote, offer y faq), sin restos del servicio anterior.
- Lo que el dueño excluyó (un idioma, un servicio, una zona) nunca se ofrece ni se sugiere agregar después.
- Idiomas: solo los del perfil (languages). Nunca digas que atiende en inglés o que es bilingüe si no lo dijo. Lo que el dueño dijo que no quiere hacer nunca es argumento de venta.
- Un solo juego de números: usa exactamente los nombres y precios de los paquetes. Si cambias un precio, cámbialo en todos lados (paquetes, nota de precios, oferta, preguntas frecuentes).
- Precios: si los cambia, explica en una línea cómo queda el margen frente a sus costos y al rango de la zona.
- Oferta: solo si él la quiere. Una oferta de bienvenida para clientes nuevos (solo su primer servicio) no necesita fecha: guárdala con forNewClients=true. Cualquier otra promoción necesita una fecha de fin real (YYYY-MM-DD, hoy es {TODAY}). Si no quiere oferta, guarda noOffer=true y apruébala.
- Si la propuesta ya está aprobada ("stage": "approved"), ayuda con cambios igual que antes.
- Máximo 60 palabras. Sin títulos ni listas.
- Nunca menciones el estado, el JSON, nombres de campos, herramientas ni notas como "(Tarjeta mostrada…)".`;

// Added to every stage: the whole road, and what to do when the owner is lost
// or just says "ok". The Brain always knows where they are and what comes next.
const GUIDE = `

El camino completo (úsalo para explicar dónde va la persona; nombra los pasos así):
- Si mode es A o B: 1) Te conozco (unas preguntas) → 2) Investigación (1 a 2 minutos, la hace Sevrii solo) → 3) Propuesta (la revisa parte por parte: servicio, presentación, paquetes, oferta y preguntas frecuentes) → 4) Aprobado. Después, en Store se arma su página y en Marketing sus anuncios.
- Si mode es C: 1) Te conozco → 2) Ideas (Sevrii investiga y propone 3, 1 a 2 minutos) → 3) Escoges una → 4) Tu agente (cómo trabaja con cada cliente, sus límites, hasta dónde atiende y su nombre) → 5) Investigación → 6) Propuesta → 7) Aprobado. Después, en Store se publica el agente y en Marketing sus anuncios.

Piensa antes de responder: mira el estado, lo que ya está guardado y lo que falta, y decide cuál es el siguiente paso real.

Si la persona escribe algo corto como "ok", "ya", "listo", "dale", "sí", "y ahora", "qué pasó", "qué sigue", "no entiendo" o "?":
1. Si tu último mensaje recomendaba una opción o pedía confirmar algo, tómalo como un sí: guárdalo o aplícalo con tu herramienta en este mismo turno.
2. Dile en una frase en qué paso va y qué viene ("Vamos en el paso 4, Tu agente; después investigo y te muestro la propuesta").
3. Si todavía falta algo suyo, pregúntalo con tu opción recomendada ya puesta ("Te propongo X. ¿Lo dejo así?"). Debajo del chat aparecen botones con las respuestas.
Nunca repitas una pregunta con las mismas palabras: si no la contestó, propón tú una respuesta concreta. Nunca digas que su mensaje se cortó.`;

const PROFILE_PROPS: Record<string, unknown> = {
  businessName: { type: "string" },
  ownerName: { type: "string", description: "The person's first name, only if they said it" },
  city: { type: "string" },
  zip: { type: "string", description: "5-digit US ZIP code where they are based (local services)" },
  state: { type: "string", description: "2-letter US state code, e.g. FL" },
  radiusMiles: { type: "number", description: "Local services: how many miles they travel from their city" },
  serviceMode: {
    type: "string",
    enum: ["local", "remote"],
    description: "local = done in person in an area (cleaning, moving, repairs, beauty at home). remote = can be done online from anywhere (video editing, design, bookkeeping, tutoring online).",
  },
  remoteScope: {
    type: "string",
    enum: ["us", "state", "world"],
    description: "Remote only: customers anywhere in the US (us), only in their own state (state: e.g. helping people get a Texas license, state-specific taxes or paperwork; save their state too) or also in other countries (world)",
  },
  languages: { type: "string", enum: ["es", "en", "both"] },
  yearsExperience: { type: "number", description: "Years doing this work in total (may include working for others)" },
  yearsOwnBusiness: { type: "number", description: "Of those, years running their own business (0 if just starting on their own)" },
  mainService: { type: "string" },
  exampleJob: { type: "string" },
  typicalCustomer: { type: "string" },
  howGetsClients: { type: "string" },
  currentPrice: { type: "string" },
  costs: { type: "string" },
  differentiators: { type: "string" },
  licenseStatus: { type: "string", enum: ["has", "no", "not_needed"] },
  licenseNote: { type: "string", description: "Which license / certification, if any" },
  insured: { type: "string", enum: ["yes", "no"] },
  workHistory: { type: "string" },
  askedFor: { type: "string" },
  tools: { type: "string" },
  hasVehicle: { type: "string", enum: ["yes", "no"] },
  hoursPerWeek: { type: "number", description: "Only a number the person said. 'Medio tiempo' / 'part time' is not a number: ask how many hours" },
  costHoursPerJob: { type: "number", description: "Hours one job takes them (or one client a month for a monthly service), exactly as they said it" },
  costMaterialsUsd: { type: "number", description: "Dollars of materials or tools per job (or per client a month); 0 if they said free / nothing" },
  startBudgetUsd: { type: "number" },
  notWant: { type: "string" },
  goal: { type: "string", enum: ["extra", "fulltime"] },
  toolsReady: { type: "string", enum: ["yes", "no"] },
  agentInterest: { type: "string", description: "C only: topics, problems or markets they'd like the agent to solve, or their own agent idea ('open to any idea' is valid)" },
  agentTask: { type: "string", description: "C only: the complete task the AI agent DOES for each customer, end to end (the result it leaves done, where it operates, what it asks, how it proves it's done)" },
  agentKnowledge: { type: "string", description: "C only, optional: material or know-how the creator wants to add to the agent" },
  agentLimits: { type: "string", description: "C only: what the agent must never do, and when the owner steps in" },
  agentEdge: { type: "string", description: "C only: why someone would pay for THEIR agent instead of a free AI chat (own method or cases, local rules, follow-up, final human check, niche)" },
};

const SAVE_PROFILE: Tool = {
  name: "save_profile",
  description: "Save what the owner told you. Send only the fields you learned in this message.",
  input_schema: { type: "object", properties: PROFILE_PROPS },
};
const CHOOSE_IDEA: Tool = {
  name: "choose_idea",
  description: "The person picked one of the 3 ideas.",
  input_schema: { type: "object", properties: { number: { type: "integer", enum: [1, 2, 3] } }, required: ["number"] },
};
const MORE_IDEAS: Tool = {
  name: "more_ideas",
  description: "None of the 3 ideas convinces the person: search for different ones, taking their feedback into account.",
  input_schema: {
    type: "object",
    properties: { feedback: { type: "string", description: "What they didn't like and what they'd prefer, in their words" } },
    required: ["feedback"],
  },
};
const OWN_IDEA: Tool = {
  name: "own_idea",
  description: "The person wants their own idea instead of the 3 proposed: save it as the chosen idea.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short title, max 90 chars" },
      what: { type: "string", description: "What it does and for whom, one line" },
    },
    required: ["title"],
  },
};
const UPDATE_PROPOSAL: Tool = {
  name: "update_proposal",
  description: "Change parts of the proposal. Send only the fields that change; lists replace the previous list.",
  input_schema: {
    type: "object",
    properties: {
      service: { type: "string" },
      serviceIncludes: { type: "string" },
      serviceExcludes: { type: "string" },
      steps: { type: "array", items: { type: "string" } },
      customer: { type: "string" },
      problem: { type: "string" },
      promise: { type: "string" },
      differentiators: { type: "array", items: { type: "string" } },
      packages: {
        type: "array",
        items: {
          type: "object",
          properties: { name: { type: "string" }, price: { type: "string" }, includes: { type: "string" }, note: { type: "string" } },
          required: ["name", "price"],
        },
      },
      pricingNote: { type: "string" },
      offer: {
        type: "object",
        properties: {
          label: { type: "string" },
          detail: { type: "string" },
          endsAt: { type: "string", description: "YYYY-MM-DD, a real date the owner gave (not needed for a new-customer offer)" },
          forNewClients: { type: "boolean", description: "Only for each customer's first service (no end date needed)" },
        },
        required: ["label"],
      },
      noOffer: { type: "boolean", description: "true if the owner doesn't want an offer" },
      resolvedWarnings: { type: "array", items: { type: "string" }, description: "Exact text of 'keep in mind' warnings the conversation already resolved: they are removed" },
      faq: { type: "array", items: { type: "object", properties: { q: { type: "string" }, a: { type: "string" } }, required: ["q", "a"] } },
      agent: {
        type: "object",
        description: "C only: the AI agent (send the whole object when it changes)",
        properties: {
          name: { type: "string" },
          role: { type: "string" },
          steps: { type: "array", items: { type: "string" } },
          limits: { type: "array", items: { type: "string" } },
          greeting: { type: "string" },
        },
      },
    },
  },
};
const APPROVE_BLOCKS: Tool = {
  name: "approve_blocks",
  description: "The owner approved these blocks.",
  input_schema: {
    type: "object",
    properties: { blocks: { type: "array", items: { type: "string", enum: APPROVAL_BLOCKS } } },
    required: ["blocks"],
  },
};

const FIELD_BLOCK: Record<string, ApprovalBlock> = {
  service: "service",
  serviceIncludes: "service",
  serviceExcludes: "service",
  steps: "service",
  customer: "service",
  problem: "service",
  promise: "pitch",
  differentiators: "pitch",
  packages: "packages",
  pricingNote: "packages",
  offer: "offer",
  noOffer: "offer",
  faq: "faq",
  agent: "service",
};

export const LOCKED_STAGES: PlanStage[] = ["ideas_research", "research"];

// "ok", "ya", "y ahora?", "qué pasó"… (the owner agrees or is lost).
const LOST = /^(ok(ay|is)?|ya|listo|dale|va|s[ií]+|bueno|perfecto|y\s*ahora|ahora\s*qu[eé]|qu[eé]\s*(pas[oó]|sigue|hago|m[aá]s|ahora)|y\s*(luego|despu[eé]s|qu[eé])|no\s*entiendo|c[oó]mo\s*sigo|\?+|yes|so|what\s*now|now\s*what|what'?s\s*next|next)[\s.!?¿¡]*$/i;

function stageOf(plan: BusinessPlan): { system: string; tools: Tool[] } {
  if (plan.stage === "interview" || plan.stage === "ready_check") return { system: INTERVIEWER + GUIDE, tools: [SAVE_PROFILE] };
  if (LOCKED_STAGES.includes(plan.stage)) return { system: INTERVIEWER + GUIDE, tools: [SAVE_PROFILE] };
  if (plan.stage === "choose") return { system: CHOOSER + GUIDE, tools: [CHOOSE_IDEA, MORE_IDEAS, OWN_IDEA] };
  return { system: EDITOR.replace("{TODAY}", today(plan.profile.state)) + GUIDE, tools: [UPDATE_PROPOSAL, APPROVE_BLOCKS] };
}

function state(b: BusinessRow) {
  const p = b.plan;
  const base = {
    stage: p.stage,
    mode: p.mode === "new" ? "B: starting a new service" : p.mode === "agent" ? "C: an AI agent that delivers the service by itself" : "A: already offers a service",
    today: today(p.profile.state),
  };
  if (p.stage === "interview" || p.stage === "ready_check") {
    const idea = p.chosenIdea !== null ? p.ideas[p.chosenIdea] : null;
    const missing = missingProfile(p);
    // One question at a time: the model only gets the next thing to ask.
    return { ...base, missing: missing.slice(0, 1), stillToAskAfterThis: Math.max(0, missing.length - 1), profile: p.profile, ...(idea ? { chosenIdea: idea } : {}) };
  }
  if (p.stage === "choose")
    return { ...base, ideas: p.ideas.map((i, n) => ({ number: n + 1, ...i })), rejectedBefore: p.rejectedIdeas, roundsLeft: Math.max(0, MAX_IDEA_ROUNDS - p.ideaRounds) };
  return {
    ...base,
    profile: p.profile,
    market: { prices: p.market.prices, requirements: p.market.requirements },
    // The one way to cite the market (the same text the owner sees in the card).
    marketRange: marketRangeText(p.market.prices, "es"),
    note: "Everything in the cards and in the proposal was written by Sevrii, not by the owner.",
    proposal: {
      service: p.service,
      serviceIncludes: p.serviceIncludes,
      customer: p.customer,
      problem: p.problem,
      promise: p.promise,
      differentiators: p.differentiators,
      packages: p.packages,
      pricingNote: p.pricingNote,
      offer: p.offer,
      noOffer: p.noOffer,
      faq: p.faq,
      ...(p.mode === "agent" ? { agent: p.agent } : {}),
    },
    warnings: p.guard.warn,
    approvals: p.approvals,
    notApprovedYet: APPROVAL_BLOCKS.filter((x) => !p.approvals[x]),
    currentPart: p.stage === "proposal" ? (APPROVAL_BLOCKS.find((x) => !p.approvals[x]) ?? "all approved") : "none (approved)",
  };
}

// Approve blocks; when all are approved and the final checks pass, the
// expediente is done.
export function applyApprovals(plan: BusinessPlan, blocks: ApprovalBlock[], lang: Lang): { plan: BusinessPlan; refused: string[] } {
  const refused: string[] = [];
  const approvals = { ...plan.approvals };
  let next = { ...plan };
  for (const blk of blocks) {
    if (blk === "offer" && !plan.offer) next = { ...next, noOffer: true };
    if (blk === "offer" && plan.offer && !plan.offer.endsAt && !plan.offer.forNewClients) {
      refused.push(lang === "es" ? "La oferta necesita una fecha de fin. Dímela en el chat o quita la oferta." : "The offer needs an end date. Tell me in the chat or remove the offer.");
      continue;
    }
    if (!blockHasContent(next, blk)) continue;
    approvals[blk] = true;
  }
  next = { ...next, approvals };
  if (allApproved(next)) {
    const g = codeGuard(next, lang, true);
    if (g.block.length) {
      refused.push(...g.block);
      next = { ...next, guard: { ...next.guard, block: g.block } };
    } else {
      next = { ...next, stage: "approved", ready: true, approvedAt: today(next.profile.state), guard: { block: [], warn: next.guard.warn } };
    }
  }
  return { plan: parsePlan(next), refused };
}

async function renameProject(b: BusinessRow, name: string) {
  const clean = name.trim().slice(0, 80);
  if (!clean || clean === b.name) return;
  await updateBusinessDetails(b.id, { name: clean });
  // The temporary address changes to the real name while the page is a draft.
  if (!b.published && b.slug.startsWith("proyecto-")) {
    const base = slugify(clean) || "negocio";
    let slug = base;
    for (let n = 2; await isSlugTaken(slug); n++) slug = `${base}-${n}`;
    await updateBusinessSlug(b.id, slug);
  }
}

// Placeholders the model sometimes saves as a business name.
const NO_NAME = /^(sin nombre|no tengo|todav[ií]a no|a[uú]n no|ninguno|ninguna|n\/?a|none|no name|not yet|no tiene|sin nombre todav[ií]a|por definir|tbd|-+)\b/i;
const fold = (x: string) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Did the owner actually talk about languages? (the model sometimes guesses
// them from the language they write in, or from "Hispanic customers").
const SAID_LANGUAGES = /\b(espa[ñn]ol|ingl[eé]s|spanish|english|idiomas?|languages?|biling[uü]e|bilingual|ambos|los dos|both)\b/i;

// A profile that was completed while the owner was over their research limit
// stays in the interview. Once research can start (new month, a higher plan,
// a tester account) it moves on by itself: the old limit message is corrected
// so the chat never ends on a dead end. Returns the updated business, or null.
const LIMIT_MSG = /(l[ií]mite de este mes|l[ií]mite de tu plan|investigaciones de tu plan|research limit|limit for this month|research runs in your plan|presupuesto de IA|AI budget)/i;
export async function resumeStuckResearch(b: BusinessRow, lang: Lang): Promise<BusinessRow | null> {
  const plan = b.plan;
  if (plan.stage !== "interview" && plan.stage !== "ready_check") return null;
  if (missingProfile(plan).length) return null;
  if (!(await researchWouldStart(b.userId))) return null;
  const stage: PlanStage = plan.stage === "interview" && (plan.mode === "new" || plan.mode === "agent") ? "ideas_research" : "research";
  await updateBusinessPlan(b.id, parsePlan({ ...plan, stage, runId: "" }));
  const es = lang !== "en";
  const recent = (await listChatMessages(b.id, "plan")).slice(-8);
  for (const m of recent) {
    if (m.role !== "user" && LIMIT_MSG.test(m.content) && !m.content.includes("[[")) {
      await updateChatMessage(b.id, m.id, es ? "Quedó guardado todo tu perfil. (Aquí había un aviso de límite que ya no aplica: tu plan permite seguir.)" : "Your whole profile is saved. (There was a limit notice here that no longer applies: your plan lets you continue.)");
    }
  }
  await addChatMessage(b.id, "plan", "ai", es ? "Ya puedo seguir: empiezo a investigar ahora (1 o 2 minutos). Verás el avance aquí en el chat." : "I can keep going now: starting the research (1-2 minutes). You'll see the progress here in the chat.");
  return (await getBusinessById(b.id)) ?? null;
}

// Approving a part of the proposal from the chat needs the owner to say so:
// "apruebo", "así está bien", or a bare "sí/ok/dale" answering the card. A
// generic "continúa con el resto" is not an approval (the card's button is).
const EXPLICIT_APPROVAL = /(apru[eé]b|aprob|approv|as[ií] est[aá] bien|est[aá] bien as[ií]|d[eé]jal[ao]s? as[ií]|me gusta (as[ií]|como est[aá]|esta parte|eso)|confirm|looks good|keep it)/i;
const BARE_YES = /^\s*(s[ií]|ok(ay)?|dale|listo|perfecto|me gusta|de acuerdo|yes|yep|sure|good)[\s.!¡]*$/i;
const NOT_APPROVAL = /(contin[uú]|sigue|siguiente|next|go on|el resto|the rest)/i;
export function saidApproval(lastMessage: string): boolean {
  const m = lastMessage.trim();
  if (EXPLICIT_APPROVAL.test(m)) return true;
  return BARE_YES.test(m) && !NOT_APPROVAL.test(m);
}

// Rules that must hold on every turn, re-sent with each message so a long
// chat never loses them (the code checks them too).
const HARD_RULES = `(Reglas de siempre: una sola pregunta por mensaje; guarda números solo si la persona los dijo, nunca conviertas "medio tiempo" u otra respuesta vaga en un número; no cambies precios sin su OK explícito; responde primero lo que pregunta, con otras palabras si no entendió; nada de notas internas, nombres de campos ni "expediente"; no pidas seguros ni permisos que no sean indispensables.)`;

async function runTool(name: string, input: Record<string, unknown>, b: BusinessRow, lang: Lang, ownerSaid = "", lastSaid = "", lastAssistant = ""): Promise<{ out: string; startPipeline?: boolean }> {
  const plan = b.plan;
  switch (name) {
    case "save_profile": {
      if (plan.stage !== "interview" && plan.stage !== "ready_check") return { out: "error: not in the interview" };
      let note = "";
      if (input.languages !== undefined && !SAID_LANGUAGES.test(ownerSaid)) {
        delete input.languages;
        note = " (languages NOT saved: the owner never said which languages they serve in; ask them: español, inglés o los dos)";
      }
      // A number is saved only if the owner said it ("medio tiempo" is not 20 hours).
      for (const [k, rule] of Object.entries(OWNER_NUMBERS)) {
        if (input[k] === undefined || input[k] === null) continue;
        const n = Number(input[k]);
        if (!Number.isFinite(n) || !ownerStated(n, ownerSaid, rule.zeroOk)) {
          delete input[k];
          note += ` (${k} NOT saved: the owner never said that number. Ask them ${rule.ask}; never assume it)`;
        }
      }
      // "No tengo nombre" is not a name: the Brain suggests some instead.
      if (typeof input.businessName === "string" && NO_NAME.test(input.businessName.trim())) {
        delete input.businessName;
        note += " (businessName NOT saved: they have no name yet. In THIS message suggest 2 or 3 short names that fit their service and city and ask which one they like)";
      }
      const profile = parseProfile({ ...plan.profile, ...input });
      let next: BusinessPlan = { ...plan, profile };
      // A change of mind: the new service replaces the chosen idea everywhere
      // (research, proposal and page), so nothing of the old one is left.
      const chosen = plan.chosenIdea !== null ? plan.ideas[plan.chosenIdea] : null;
      if (typeof input.mainService === "string" && profile.mainService && (plan.service || chosen) && fold(profile.mainService) !== fold(plan.service || chosen?.title || "")) {
        next = { ...next, service: profile.mainService, chosenIdea: null };
        note += ` (the service is now "${profile.mainService}": from now on talk only about it; the previous idea is gone)`;
      }
      if (typeof input.businessName === "string" && profile.businessName) await renameProject(b, profile.businessName);
      const left = missingProfile(next);
      if (left.length) {
        await updateBusinessPlan(b.id, parsePlan(next));
        return { out: `saved${note}. still missing: ${left.join(", ")}` };
      }
      // B and C start from ideas the Brain researches; A already has its service.
      const stage: PlanStage = plan.stage === "interview" && (plan.mode === "new" || plan.mode === "agent") ? "ideas_research" : "research";
      if (!(await researchWouldStart(b.userId))) {
        await updateBusinessPlan(b.id, parsePlan(next));
        const msg = researchLimitText(await researchUsage(b.userId), lang === "en" ? "en" : "es");
        return { out: `saved${note}. profile complete, BUT the research can't start now. Tell the owner kindly, with these exact facts and nothing else about plans (don't suggest upgrading unless this text does): "${msg}"` };
      }
      next = { ...next, stage, runId: "" };
      await updateBusinessPlan(b.id, parsePlan(next));
      return { out: `saved${note}. profile complete: stage moved to ${stage}. Tell the owner you will now research their area (1-2 minutes) and they will see the progress here in the chat. Do NOT ask any question now: the chat is locked during the research.`, startPipeline: true };
    }
    case "choose_idea": {
      if (plan.stage !== "choose") return { out: "error: not choosing ideas now" };
      const i = Number(input.number) - 1;
      const idea = plan.ideas[i];
      if (!idea) return { out: "error: unknown idea" };
      await updateBusinessPlan(b.id, parsePlan(chooseIdea(plan, i)));
      return { out: `chosen: ${idea.title}. Now ask the remaining readiness questions (see missing).` };
    }
    case "own_idea": {
      if (plan.stage !== "choose") return { out: "error: not choosing ideas now" };
      const title = str(input.title, 140);
      if (!title) return { out: "error: no title" };
      // C: their idea goes through the same research and scoring before going on.
      if (plan.mode === "agent") {
        if (!(await researchWouldStart(b.userId, { budgetOnly: true })))
          return { out: `error: their idea can't be researched now. Facts to tell them (don't suggest upgrading unless this text does): "${researchLimitText(await researchUsage(b.userId), lang === "en" ? "en" : "es")}". Meanwhile help them pick one of the current ideas.` };
        const what = str(input.what, 800);
        await updateBusinessPlan(b.id, parsePlan({ ...requestMoreIdeas(plan, ""), ownIdea: `${title}${what ? `: ${what}` : ""}` }));
        return { out: "evaluating their idea with the same research (1-2 minutes). Tell them in one line you'll check their idea against what people pay and need, and show it here next to 2 alternatives.", startPipeline: true };
      }
      const own = { title, why: str(input.what, 800), typicalPrice: "", startCost: "", license: "", demand: "", how: "", pros: "", cons: "", score: 0, sources: [] };
      const ideas = [...plan.ideas.slice(0, 4), own];
      await updateBusinessPlan(b.id, parsePlan(chooseIdea({ ...plan, ideas }, ideas.length - 1)));
      return { out: `chosen their own idea: ${title}. Now ask the remaining readiness questions (see missing).` };
    }
    case "more_ideas": {
      if (plan.stage !== "choose") return { out: "error: not choosing ideas now" };
      if (plan.ideaRounds >= MAX_IDEA_ROUNDS) return { out: "error: no more idea rounds; help them pick or describe a service they want" };
      if (!(await researchWouldStart(b.userId, { budgetOnly: true })))
        return { out: `error: no new search now. Facts to tell them (don't suggest upgrading unless this text does): "${researchLimitText(await researchUsage(b.userId), lang === "en" ? "en" : "es")}". Their 3 ideas are still here: help them pick one.` };
      await updateBusinessPlan(b.id, requestMoreIdeas(plan, str(input.feedback, 300)));
      return { out: "searching new ideas. Tell them in one line you're looking for different options with what they said (1-2 minutes) and they'll see them here in the chat.", startPipeline: true };
    }
    case "update_proposal": {
      if (plan.stage !== "proposal" && plan.stage !== "approved") return { out: "error: no proposal yet" };
      const patch: Record<string, unknown> = { ...input };
      // Prices are locked: a new amount needs the owner's explicit OK.
      if (Array.isArray(input.packages)) {
        const after = parsePlan({ ...plan, packages: input.packages }).packages;
        const lock = priceChangeAllowed(plan.packages, after, lastSaid, lastAssistant, saidApproval(lastSaid));
        if (!lock.ok)
          return { out: `error: prices are locked. Nothing changed. The owner never agreed to $${lock.changed.join(", $")}. If you think a price should change, ask them first in one line (say the exact new amount and why) and change it only after they say yes.` };
      }
      // Warnings the conversation resolved go away (they never reopen a part).
      const resolved = Array.isArray(input.resolvedWarnings) ? input.resolvedWarnings.map((x) => String(x).trim().toLowerCase()).filter((x) => x.length >= 12) : [];
      delete patch.resolvedWarnings;
      const warnLeft = plan.guard.warn.filter((w) => !resolved.some((r) => w.trim().toLowerCase() === r || w.toLowerCase().includes(r) || r.includes(w.toLowerCase())));
      // "Make it 20%" sends only the changed offer field: keep the rest
      // (who it's for, the detail, the end date) instead of losing it.
      if (input.offer && typeof input.offer === "object" && plan.offer) patch.offer = { ...plan.offer, ...(input.offer as Record<string, unknown>) };
      if (input.offer) patch.noOffer = false;
      if (input.agent && typeof input.agent === "object" && plan.agent) patch.agent = { ...plan.agent, ...(input.agent as Record<string, unknown>) };
      if (input.noOffer === true) patch.offer = null;
      // Only a field that really changes takes its part's approval away: asking
      // about one part (or resending a field as it was) never resets another.
      const touched = new Set<ApprovalBlock>();
      const before = plan as unknown as Record<string, unknown>;
      for (const k of Object.keys(patch)) {
        if (!FIELD_BLOCK[k]) continue;
        const now = (parsePlan({ ...plan, [k]: patch[k] }) as unknown as Record<string, unknown>)[k];
        if (JSON.stringify(now) !== JSON.stringify(before[k])) touched.add(FIELD_BLOCK[k]);
        else delete patch[k];
      }
      // A price that changes, changes everywhere: the old amount is replaced in
      // the texts this edit didn't send (video script, notes, offer, FAQ), so
      // nothing made later (Store, Marketing) reads the old price.
      if (Array.isArray(patch.packages)) Object.assign(patch, repriced(plan, patch));
      const approvals = { ...plan.approvals };
      for (const t of touched) delete approvals[t];
      // Only an edit to an approval block reopens the proposal; anything else
      // (video script, photo ideas…) keeps the stage as it was.
      const reopen = touched.size > 0;
      let next = parsePlan({ ...plan, ...patch, approvals, ...(reopen ? { stage: "proposal", ready: false } : {}) });
      // Invented amounts or hours, or internal words, never reach the owner.
      const silent = silentProposalIssues(next);
      if (silent.length) return { out: `error: not saved, fix it and send it again: ${silent.join(" ")}` };
      const g = codeGuard(next, lang, false);
      next = { ...next, guard: { block: g.block, warn: warnLeft } };
      // Everything still approved (nothing to re-approve): finish it again.
      if (next.stage === "proposal" && allApproved(next)) next = applyApprovals(next, [], lang).plan;
      await updateBusinessPlan(b.id, next);
      const gone = plan.guard.warn.length - warnLeft.length;
      return { out: `saved. blocks that need approval again: ${[...touched].join(", ") || "none"}${gone ? `; ${gone} warning(s) removed` : ""}${g.block.length ? `; problems: ${g.block.join(" ")}` : ""}` };
    }
    case "approve_blocks": {
      if (plan.stage !== "proposal") return { out: "error: nothing to approve" };
      if (!saidApproval(lastSaid))
        return { out: "not approved: the owner did not explicitly approve this part (asking to continue is not an approval). Nothing changed. Tell them in one line that to go on they approve this part with the card's \"Aprobar\" button (or tell you it's approved), or say what to change." };
      const blocks = (Array.isArray(input.blocks) ? input.blocks : []).filter((x): x is ApprovalBlock => APPROVAL_BLOCKS.includes(x as ApprovalBlock));
      const { plan: next, refused } = applyApprovals(plan, blocks, lang);
      await updateBusinessPlan(b.id, next);
      const built = next.stage === "approved" ? (await fillStoreFromPlan(b.id, lang, { onlyIfEmpty: true })).filled : false;
      return { out: `${next.stage === "approved" ? (built ? "all approved: the store page was built from the expediente automatically; tell the owner to open Store to see it" : "all approved: the expediente is ready; the owner can update the page from Store") : "approved"}${refused.length ? `; not approved: ${refused.join(" ")}` : ""}` };
    }
    default:
      return { out: "error: unknown tool" };
  }
}

function repriced(plan: BusinessPlan, patch: Record<string, unknown>): Record<string, unknown> {
  const after = (patch.packages as { name?: unknown; price?: unknown }[]).map((x) => ({ name: String(x?.name ?? ""), price: String(x?.price ?? "") }));
  const moves = priceMoves(plan.packages, after);
  if (!moves.size) return {};
  const out: Record<string, unknown> = {};
  const sw = (t: string) => swapAmounts(t, moves);
  if (patch.videoScript === undefined) out.videoScript = sw(plan.videoScript);
  if (patch.pricingNote === undefined) out.pricingNote = sw(plan.pricingNote);
  if (patch.promise === undefined) out.promise = sw(plan.promise);
  if (patch.faq === undefined) out.faq = plan.faq.map((f) => ({ q: sw(f.q), a: sw(f.a) }));
  if (patch.offer === undefined && plan.offer) out.offer = { ...plan.offer, label: sw(plan.offer.label), detail: sw(plan.offer.detail) };
  // Only what really changed is kept (an unchanged FAQ must not reopen its part).
  for (const k of Object.keys(out)) if (JSON.stringify(out[k]) === JSON.stringify((plan as unknown as Record<string, unknown>)[k])) delete out[k];
  return out;
}

export function chooseIdea(plan: BusinessPlan, i: number): BusinessPlan {
  const idea = plan.ideas[i];
  return parsePlan({
    ...plan,
    chosenIdea: i,
    stage: "ready_check",
    service: idea.title,
    profile: { ...plan.profile, mainService: idea.title },
  });
}

export type BrainChatResult = { reply: string; business: BusinessRow; startPipeline: boolean; debug?: string };

export async function runPlanChatTurn(opts: {
  business: BusinessRow;
  history: { role: "user" | "assistant"; content: string }[];
  message: string;
  lang: Lang;
}): Promise<BrainChatResult> {
  let business = opts.business;
  const es = opts.lang === "es";
  if (LOCKED_STAGES.includes(business.plan.stage)) {
    return {
      reply: es ? "Estoy investigando tu zona. En un momento te muestro lo que encontré." : "I'm researching your area. I'll show you what I found in a moment.",
      business,
      startPipeline: true,
    };
  }
  const client = getClaude();
  if (!client) {
    console.error("[ai:brain] ANTHROPIC_API_KEY is not set");
    return {
      reply: es ? "El asistente no está disponible en este momento. Inténtalo de nuevo en unos minutos." : "The assistant isn't available right now. Please try again in a few minutes.",
      business,
      startPipeline: false,
    };
  }

  // What the owner wrote in this chat (to check facts the model saves).
  const ownerSaid = [...opts.history.filter((h) => h.role === "user").map((h) => h.content), opts.message].join("\n");
  const lastAssistant = [...opts.history].reverse().find((h) => h.role === "assistant")?.content ?? "";
  const askedSomething = isQuestionTurn(opts.message);
  const messages: MessageParam[] = [
    ...opts.history.map((h): MessageParam => ({ role: h.role, content: h.content })),
    { role: "user", content: `State (JSON):\n${JSON.stringify(state(business))}\n\nOwner: ${opts.message}${LOST.test(opts.message.trim()) ? "\n\n(Internal note: a short or lost reply. Follow the rules for \"ok\" / lost replies: act on your last recommendation, say which step they are on and what comes next.)" : ""}${askedSomething ? "\n\n(Internal note: the owner asked something or didn't understand. Answer exactly that, in simpler words, and don't ask them to approve anything in this message.)" : ""}\n\n${HARD_RULES}` },
  ];
  let reply = "";
  let startPipeline = false;
  let nudged = false;
  let debug = "";
  try {
    for (let step = 0; step < 7; step++) {
      const st = stageOf(business.plan);
      const system = st.system;
      // A question or "no entendí" is answered, never turned into an approval.
      const tools = askedSomething ? st.tools.filter((t) => t.name !== "approve_blocks") : st.tools;
      const res = await client.messages.create({
        model: MODELS.chat,
        max_tokens: 6000,
        thinking: { type: "between_tools" },
        // Medium: it thinks about where the owner is and what comes next.
        output_config: { effort: "medium" },
        system: [{ type: "text", text: `${system}\n\nReply in ${es ? "Spanish (neutral, 'tú')" : "English"}.`, cache_control: { type: "ephemeral" } }],
        ...(tools.length ? { tools } : {}),
        messages,
      });
      const text = textOf(res.content);
      if (text) reply = text;
      const uses = res.content.filter((c): c is ToolUseBlock => c.type === "tool_use");
      // Tools run whenever the model asked for them (a cut-off answer may hold
      // an unfinished one, so not then).
      if (uses.length === 0 || res.stop_reason === "max_tokens") {
        // Sometimes the model ends a turn without a word for the person. Ask once more.
        if (!reply && !nudged) {
          nudged = true;
          // Never resend a tool call without its result (the API rejects it).
          const kept = res.content.filter((c) => c.type !== "tool_use");
          if (kept.some((c) => c.type === "text")) messages.push({ role: "assistant", content: kept });
          messages.push({
            role: "user",
            content: es
              ? "(Sistema: no respondiste nada. Si la persona te dio datos, guárdalos con save_profile. Después respóndele en una o dos frases y haz la siguiente pregunta de \"missing\".)"
              : "(System: you didn't reply. If the person gave you data, save it with save_profile. Then reply in one or two sentences and ask the next question from \"missing\".)",
          });
          continue;
        }
        break;
      }
      const results: ToolResultBlockParam[] = [];
      for (const u of uses) {
        let out: string;
        try {
          const r = await runTool(u.name, (u.input ?? {}) as Record<string, unknown>, business, opts.lang, ownerSaid, opts.message, lastAssistant);
          out = r.out;
          if (r.startPipeline) startPipeline = true;
        } catch (err) {
          console.error("[ai:brain] tool failed", u.name, err);
          out = "error: could not save";
        }
        business = (await getBusinessById(business.id))!;
        results.push({ type: "tool_result", tool_use_id: u.id, content: out });
      }
      messages.push({ role: "assistant", content: res.content });
      messages.push({ role: "user", content: [...results, { type: "text", text: `Updated state (JSON):\n${JSON.stringify(state(business))}` }] });
    }
  } catch (err) {
    logAiError("brain", err);
    debug = String((err as Error)?.message || err).slice(0, 400);
    reply = aiErrorReply(err, opts.lang === "en" ? "en" : "es");
  }
  if (!reply && startPipeline) {
    reply = es ? "¡Listo! Ya tengo lo que necesito. Ahora voy a investigar tu zona; en 1 o 2 minutos te muestro aquí lo que encontré." : "Done! I have what I need. I'll research your area now; I'll show you what I found here in 1-2 minutes.";
  }
  // The chat is locked while the research runs: a question there can't be
  // answered, so it's taken out of the message.
  if (startPipeline && /[?¿]/.test(reply)) {
    const kept = reply.split(/(?<=[.!?])\s+/).filter((x) => !/[?¿]/.test(x)).join(" ").trim();
    reply =
      kept ||
      (es ? "¡Listo! Ya tengo lo que necesito. Ahora voy a investigar tu zona; en 1 o 2 minutos te muestro aquí lo que encontré." : "Done! I have what I need. I'll research your area now; I'll show you what I found here in 1-2 minutes.");
  }
  // Checked in code on every reply: no repeat claims, one question, no
  // approval script after a question, and no sentence with internal words.
  reply = noRepeatClaims(reply);
  reply = oneQuestion(reply);
  if (askedSomething) reply = dropApprovalScript(reply) || reply;
  if (hasJargon(reply)) reply = reply.split(/(?<=[.!?])\s+/).filter((x) => !hasJargon(x)).join(" ").trim();
  // Never show the owner our internal notes (they sometimes get echoed).
  reply = reply
    .replace(/^\s*\((Tarjeta mostrada|Card shown)[^)\n]*\)\s*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { reply: reply || (es ? "Listo." : "Done."), business, startPipeline, debug };
}

export function planGreeting(lang: Lang, b: BusinessRow): string {
  const es = lang === "es";
  const p = b.plan;
  if (p.mode === "agent") {
    return es
      ? "¡Hola! Soy el Cerebro de Sevrii. Vamos a crear tu agente: un producto digital que resuelve un problema por chat, solo, las 24 horas, y cobra por usarlo. No tiene que ser de tu oficio: yo investigo qué problemas paga la gente por resolver y te propongo 3 ideas. Para empezar: ¿hay algún tema o tipo de problema que te interese, o quieres que te proponga ideas abiertas?"
      : "Hi! I'm Sevrii's Brain. Let's create your agent: a digital product that solves a problem by chat, by itself, 24/7, and charges for it. It doesn't have to be about your trade: I'll research what problems people pay to solve and propose 3 ideas. To start: is there a topic or kind of problem you're interested in, or should I propose open ideas?";
  }
  if (p.mode === "new") {
    return es
      ? "¡Hola! Soy el Cerebro de Sevrii. Te voy a ayudar a escoger un servicio que puedas empezar a ofrecer, según tu experiencia, tu tiempo y tu zona. Después investigo el mercado y te propongo cómo venderlo. Para empezar: ¿en qué ciudad y estado vives?"
      : "Hi! I'm Sevrii's Brain. I'll help you pick a service you can start offering, based on your experience, your time and your area. Then I'll research the market and propose how to sell it. To start: what city and state do you live in?";
  }
  return es
    ? "¡Hola! Soy el Cerebro de Sevrii. Primero te entiendo bien, después investigo tu zona y te propongo cómo vender tu servicio: a quién, a qué precio y con qué campaña. Para empezar: ¿qué servicio quieres vender y cuál fue el último trabajo que hiciste?"
    : "Hi! I'm Sevrii's Brain. First I'll get to know your business, then I'll research your area and propose how to sell your service: to whom, at what price and with what campaign. To start: what service do you want to sell, and what was the last job you did?";
}
