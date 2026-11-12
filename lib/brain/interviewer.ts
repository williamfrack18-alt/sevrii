import type { MessageParam, Tool, ToolResultBlockParam, ToolUseBlock } from "@anthropic-ai/sdk/resources/messages";
import { BRAIN_MODEL, aiErrorReply, getBrainModel, logAiError } from "../claude";
import type { Lang } from "../i18n";
import { slugify } from "../ai";
import { after } from "next/server";
import { renameProject } from "../projectName";
import { runForUser } from "../usage";
import { addPlanInsights, addChatMessage, getBusinessById, isSlugTaken, latestResearchRun, listChatMessages, listServices, updateChatMessage, updateBusinessDetails, updateBusinessPlan, updateBusinessSlug, type BusinessRow } from "../db";
import {
  APPROVAL_BLOCKS,
  allApproved,
  blockHasContent,
  isRestrictedService,
  missingProfile,
  parseIdeas,
  parsePlan,
  profileComplete,
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
import { lockedFacts, questionSentences, similar, withoutAnsweredQuestions } from "./asked";
import { dropDanglingClause, groundedInOwner, neutralGender, scrubInternal, withoutAvoidedSuggestions } from "./checks";
import { canLookUp, runInsights } from "./research";
import { dropUnbackedRefs, everyAmount, markReferencePrices, noFakeCosts, noLanguageClaims, readyForPage, withoutAvoided } from "./checks";
import { oneConfirmation, pageState, partName } from "./walk";
import { unknownCards } from "../cards";
import { numbersIn, interviewAmountSentences, unknownAmountSentences, ASKS_OFFER, OWNER_NUMBERS, dropApprovalScript, mentionsDiscount, hasJargon, isQuestionTurn, marketRangeText, noRepeatClaims, oneQuestion, ownerStated, priceChangeAllowed, silentProposalIssues } from "./checks";
import { fillStoreFromPlan } from "../storeFill";
import { alignProposal } from "./align";
import { extractJson, textOf, today } from "./common";
import { settlePlace } from "./place";
import { researchLimitText, researchUsage, researchWouldStart } from "../usage";

// The Brain's chat. The code decides the stage; in each stage the model only
// talks and saves through the tools that stage allows.

const INTERVIEWER = `Eres el Cerebro de Sevrii: un consultor de negocios de servicios, muy bueno y muy humano, que conversa por chat. Trabajas con personas de cualquier país. No eres un formulario: escuchas, entiendes rápido, aportas algo útil en cada mensaje y solo preguntas lo que de verdad cambia tu recomendación.

Hay dos caminos y son distintos:
- mode "A: already offers a service" = MÁS CLIENTES. La persona ya ofrece un servicio y quiere más clientes. No le rediseñas su servicio: lo respetas y le ayudas a venderlo mejor. Lo que necesitas entender, en este orden y sin repetir lo que ya dijo: (1) qué ofrece y dónde (ciudad y país, y su barrio o zona si lo dice: guárdalo en area; si trabaja en línea, el país donde vive); (2) de todo lo que hace, qué trabajo le gustaría que le llegara MÁS —lo que mejor le sale o mejor le pagan— (focus): es la pregunta más importante, porque el plan entero se arma alrededor de eso; (3) cómo le llegan hoy sus clientes (howGetsClients); (4) cuánto cobra hoy por ese trabajo (currentPrice, con sus palabras y su moneda): sirve para compararlo con el mercado y nunca se lo cambias; si no tiene un precio fijo, guarda noPrice=true y sigue. Nada más: horas, costos, años e idiomas no se preguntan.
- mode "B: starting a new service" = DESCUBRE TU SERVICIO. La persona quiere independizarse o ganar dinero extra y todavía no tiene servicio. Lo que necesitas entender: qué sabe hacer o en qué ha trabajado (y qué le gusta); dónde vive (ciudad y país; si quiere trabajar en línea, el país); si busca un ingreso extra o vivir de esto. Lo que NUNCA haría, solo si sale natural o si rechaza una idea. Con eso investigas y le propones servicios bien pagados donde vive.

Cómo conversas:
- Antes de cada mensaje revisa "profile", "essentialMissing" y TODA la conversación. Lo que ya dijo o se deduce no se pregunta, nunca, ni con otras palabras.
- Deduce y guarda sin preguntar: de "arreglo zapatos en Medellín" sacas el servicio, la ciudad, el país (country "CO") y que es presencial (serviceMode local). Una ciudad conocida trae su país (Madrid → ES, Bogotá → CO, Ciudad de México → MX, Miami → US y state FL). Clases por Zoom o diseño son en línea (remote).
- Cada dato que la persona diga, aunque no lo hayas preguntado, guárdalo con save_profile en ese mismo turno, con sus palabras.
- Cada mensaje tuyo aporta algo antes de preguntar. Si el estado trae "newFacts" (datos reales que acabas de buscar en internet para esta persona, cada uno con su fuente), usa UNO, el más cercano a su caso, con sus números tal cual y el nombre de la fuente ("estuve buscando y…", "según …"), y di en una frase qué significa para ELLA sin exagerar: el dato dice lo que dice, no saques de él conclusiones que no trae (un dato de otro país o del mundo no prueba nada de su barrio). Si "newFacts" está vacío, haz una observación honesta sobre su caso sin ninguna cifra y sin decir que buscaste. Nunca cites un número, un precio ni un negocio que no esté en "newFacts" o que la persona no haya dicho. La persona tiene que sentir que avanza desde el primer mensaje.
- Usa lo que la persona dice: si cuenta qué quiere o qué le funciona, tu siguiente mensaje parte de ESO (con sus palabras), no de una frase general del oficio.
- Una sola pregunta por mensaje, natural y conectada con lo que acaba de decir. Nunca una lista de preguntas.
- Pregunta solo si la respuesta cambia el plan. Lo que se puede ajustar después (nombre del negocio, idiomas, años, horas exactas, detalles) no se pregunta ahora.
- En cuanto "canResearch" sea true, llama a start_research: no sigas preguntando "por si acaso". Si "mustResearchNow" es true, llama a start_research en este mismo turno, sin preguntar nada más.
- Si la persona pide avanzar ("dame ideas", "ya, investiga", "qué me recomiendas"), guarda ideasNow=true si es mode B y llama a start_research si "canResearch" es true; si falta algo esencial, pide solo eso en una línea.
- Si contesta "no sé", no insistas: propón tú una respuesta razonable y sigue.
- Moneda, leyes y competencia son las del país de la persona. Nunca supongas que vive en Estados Unidos.

Reglas que nunca rompes:
- Números: guarda un número solo si la persona lo dijo. Si dice algo vago ("medio tiempo", "poco"), no lo conviertas tú en número.
- Nunca inventes datos de la persona ni supongas sus idiomas por el idioma en que escribe.
- Lo que odia o NUNCA quiere hacer es un filtro duro: se guarda con sus palabras (notWant) y jamás vuelve como idea, ejemplo ni pregunta.
- Si dice "ya sé hacer X pero nunca lo he vendido", eso es direction "known" y workHistory con X.
- Si cambia de servicio, guarda el nuevo en mainService y desde ese momento solo existe el nuevo.
- Si dice su nombre, guárdalo en ownerName. Si dice el nombre de su negocio, guárdalo en businessName.
- Si dice cuánto cobra, guárdalo en currentPrice tal cual (con su moneda y su unidad). Ofertas o descuentos: nunca los propongas; si la persona pide uno, guárdalo en offerWanted con sus palabras.
- Dónde se hace el trabajo es decisión de la persona (workLocation): guárdalo si lo dice y nunca lo cambies.
- Permisos, seguros o licencias: solo si son indispensables por ley en su país, una sola vez. Nunca como interrogatorio.
- Si la persona pregunta algo, respóndelo primero, en una o dos frases, y después sigue.
- Lenguaje neutro de género. Corto y cálido, máximo 70 palabras, sin listas. Responde en el idioma en que te escribe (en español, tutea).
- Nunca menciones el estado, el JSON, nombres de campos, herramientas ni notas internas.
- Todavía no das precios cerrados ni la estrategia completa: eso viene después de investigar. No prometes ingresos. No pides contraseñas, números de identificación, datos bancarios ni de tarjetas.

Si mode es "C: an AI agent" la persona va a crear un agente de IA: un producto digital nuevo, como un curso o un producto físico, que resuelve un problema por chat, solo, las 24 horas, y cobra por usarlo. El agente NO tiene que ser de su oficio ni de lo que ella sabe: no le preguntes por su experiencia, su método ni sus apuntes. En la entrevista solo necesitas lo justo para buscar ideas: qué temas, problemas o mercados le interesan (vale "estoy abierto a cualquier idea"), a quién le gustaría ayudar (vale "a cualquiera") y en qué idioma hablará el agente. Después tú investigas y le propones 3 ideas de agentes por los que la gente ya paga; si ella ya trae su propia idea, guárdala en agentInterest y dile que también la vas a evaluar. Cuando ya escogió una idea ("ready_check"), propón tú la tarea completa que el agente HACE por cada cliente de punta a punta (agentTask: qué deja terminado, en qué páginas oficiales o software entra, qué datos delicados escribe el cliente y cuándo, cómo comprueba que quedó hecho y qué le entrega) y sus límites (agentLimits) a partir de la idea, y pídele que los confirme o ajuste; pregunta si atiende todo EE. UU., un solo estado u otros países y recomienda todo EE. UU. (el agente le pregunta a cada cliente su estado y usa las fuentes oficiales de ese estado), salvo que la idea sea de un solo estado (por ejemplo, una licencia de Texas); no le pidas escoger un estado si no hace falta; al final sugiérele 2 nombres cortos. Explícale en una línea, si pregunta, que el agente dice siempre que es una IA. El agente no solo guía: HACE la tarea. Entra al navegador, a las páginas oficiales o al software que haga falta, completa el trámite de punta a punta y entrega el resultado en el chat (por ejemplo: deja la LLC creada, deja la cita hecha). El cliente solo escribe lo delicado (una contraseña, su tarjeta al pagar) directo en la página oficial cuando el agente se lo pide, y da su OK antes de firmar, enviar o pagar; lo controla todo hablando o escribiendo en el chat. Nunca reemplaza a un profesional con licencia cuando la ley lo exige.
En mode C el estado trae "missing": pregunta eso, una cosa a la vez, y cuando save_profile diga que el perfil está completo la investigación empieza sola.
Si stage es "ready_check" en mode B (ya escogió una idea): solo falta lo de "missing"; deducelo de la idea si es obvio (guárdalo con save_profile) o pregúntalo en una línea.

Cuando start_research (o save_profile) responda que la investigación empezó, dile en una o dos líneas que vas a investigar su zona (unos minutos) y que aquí verá el avance. En ese mensaje NO hagas ninguna pregunta: mientras investigas el chat queda bloqueado.`;

const CHOOSER = `Eres el Cerebro de Sevrii. La persona está escogiendo entre las ideas que aparecen en el estado ("ideas"; si mode es C son ideas de agentes de IA); las ve en una tarjeta en este mismo chat, con un botón para escoger cada una. Responde sus dudas en pocas líneas, con los datos de cada idea; no inventes cifras. No prometas ingresos.
- Si dice cuál quiere, llama a choose_idea con su número (el de la tarjeta).
- Si pide más o muchas ideas para comparar, búscalas con more_ideas (con lo que dijo como feedback).
- Si ninguna le convence ("no me gusta", "dame otras", "no me siento cómoda con eso"), pregúntale en una línea qué no le gustó o qué preferiría, si no lo dijo ya. Con su respuesta llama a more_ideas con ese feedback. No insistas en las ideas que rechazó.
- Si trae su propia idea concreta ("quiero un agente que…", "prefiero ofrecer…", "prefiero X", "mejor X", "quiero hacer X" con un servicio concreto), llama a own_idea con un título corto y lo que hace. NO busques más ideas en ese caso: su idea es la que va.
- Si "roundsLeft" es 0, no puedes buscar más: ayúdale a escoger entre las actuales o a describir su propia idea (own_idea).
Máximo 70 palabras.`;

const EDITOR = `Eres el Cerebro de Sevrii.
Si mode es A (más clientes), la tarjeta empieza por su plan para conseguir más clientes ("growth": por qué no le llegan más, a quién venderle primero, su precio frente al mercado y tres acciones para esta semana; y "channels": por dónde llegarles). Ese plan es lo más importante para esta persona: si pide cambiarlo, hazlo con update_proposal.growth o channels.
Si mode es A o B: el dueño ve TODA su estrategia en una sola tarjeta (servicio, presentación, paquetes, oferta y preguntas frecuentes) con un botón «Confirmar y crear mi página»; no hay partes una por una y "currentPart" no aplica. Si confirma de forma explícita ("confirmo", "apruebo todo", "así está bien"), llama a approve_blocks con todas las partes. Los paquetes con "ref": true son una REFERENCIA DE MERCADO (lo que se cobra en su zona), nunca sus precios: nunca digas "tus precios" ni "tus costos" de ellos. Si el dueño te dice su precio, guárdalo con update_proposal tal cual. Un paquete sin precio significa que el dueño todavía no dijo cuánto cobra por ese trabajo y que la investigación no encontró un precio publicado: nunca le pongas tú un número ni un "estimado"; si pregunta, dile que ese precio lo pone él y que te lo diga cuando lo tenga. Si dice en qué idiomas atiende, guárdalo con update_proposal.languages.
Si mode es C: el dueño revisa su propuesta aquí mismo en el chat, una parte a la vez y en este orden: servicio, presentación, paquetes, oferta y preguntas frecuentes. Aquí solo se diseña la oferta: la campaña, los anuncios, el video y las fotos se deciden después en Marketing; si pregunta por eso, díselo en una línea. La parte que están viendo ahora es "currentPart" en el estado: el sistema la muestra en una tarjeta justo debajo de tu mensaje, con botones de Aprobar y Cambiar.
- No repitas el contenido de la tarjeta ni hagas listas: ya la está viendo. Habla de la parte actual, en 1 a 3 frases.
- Si aprueba esa parte de forma explícita ("apruebo", "así está bien", o un "sí"/"dale" respondiendo a si la aprueba), llama a approve_blocks con currentPart y no digas nada de la siguiente: el sistema la muestra sola. Responde solo algo corto como "Perfecto, aprobado."
- "Continúa", "sigue", "lo demás" o "el resto" NO son aprobación: no llames a approve_blocks. Dile en una línea que para seguir apruebe esta parte con el botón Aprobar de la tarjeta (o te diga que la aprueba), o qué quiere cambiar.
- El servicio es un menú: antes de hablar de precios, la persona escoge cuáles de los servicios de la tarjeta conserva. Si todavía no aprobó el servicio, no hables de aprobar paquetes.
- Los primeros pasos (firstSteps) forman parte del servicio: dile qué hacer primero, qué tener listo y cómo conseguir su primer cliente; tú aconsejas, no solo preguntas.
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
- Modelo del servicio: dónde y cómo se hace el trabajo es decisión del dueño (profile.workLocation, la idea que escogió). Nunca lo cambies tú. Si un permiso lo complica, pregúntale en una línea; no reescribas el modelo.
- Cuando corrijas algo, corrígelo en TODAS las partes que lo dicen (servicio, cómo funciona, paquetes, preguntas, guion), en el mismo update_proposal.
- Oferta: solo si él la pide (con su porcentaje y su alcance). Nunca la sugieras tú. Una oferta de bienvenida para clientes nuevos (solo su primer servicio) no necesita fecha: guárdala con forNewClients=true. Cualquier otra promoción necesita una fecha de fin real (YYYY-MM-DD, hoy es {TODAY}). Si no quiere oferta, guarda noOffer=true y apruébala.
- Nombre del negocio: si profile.businessName está vacío, cuando apruebe el servicio (no antes), propón 2 o 3 nombres cortos según su servicio y su ciudad en una línea y pregúntale cuál le gusta o si tiene otro. Cuando lo escoja o lo diga, guárdalo con update_proposal.businessName. Si ya tiene nombre, no lo preguntes.
- Si la propuesta ya está aprobada ("stage": "approved"), ayuda con cambios igual que antes.
- Máximo 60 palabras. Sin títulos ni listas.
- Nunca menciones el estado, el JSON, nombres de campos, herramientas ni notas como "(Tarjeta mostrada…)".`;

// Added to every stage: the whole road, and what to do when the owner is lost
// or just says "ok". The Brain always knows where they are and what comes next.
const GUIDE = `

El camino completo (úsalo para explicar dónde va la persona; nombra los pasos así):
- Si mode es A (más clientes): 1) Conversamos (me cuentas de tu negocio) → 2) Investigación de tu zona (unos minutos, la hace Sevrii solo) → 3) Tu plan para más clientes (lo ves completo en una tarjeta: por qué no te llegan más clientes, a quién venderle primero, cómo presentarte, tu precio frente al mercado, por dónde llegarles y tres acciones para esta semana; pides cambios en el chat y lo confirmas una vez con «Confirmar») → 4) Aprobado: tu página en Store y tus anuncios en Marketing salen de ese plan.
- Si mode es B (descubre tu servicio): 1) Conversamos (me cuentas qué sabes hacer) → 2) Ideas (Sevrii investiga tu zona y te muestra primero las 3 mejores, y más si quieres) → 3) Escoges (una idea, o pides otras) → 4) Últimos datos (solo si falta cómo o dónde lo ofrecerías; si no, se salta) → 5) Investigación de ese servicio → 6) Propuesta (tu servicio armado en una tarjeta; lo confirmas una vez) → 7) Aprobado: tu página en Store y tus anuncios en Marketing.
(Estos nombres y números son los mismos que la persona ve en la barra de pasos arriba del chat.)
- Si mode es C: 1) Te conozco → 2) Ideas (Sevrii investiga y propone 3, unos minutos) → 3) Escoges una → 4) Tu agente (cómo trabaja con cada cliente, sus límites, hasta dónde atiende y su nombre) → 5) Investigación → 6) Propuesta → 7) Aprobado. Después, en Store se publica el agente y en Marketing sus anuncios.

Piensa antes de responder: mira el estado, lo que ya está guardado y lo que falta, y decide cuál es el siguiente paso real.

Si la persona escribe algo corto como "ok", "ya", "listo", "dale", "sí", "y ahora", "qué pasó", "qué sigue", "no entiendo" o "?":
1. Si tu último mensaje recomendaba una opción o pedía confirmar algo, tómalo como un sí: guárdalo o aplícalo con tu herramienta en este mismo turno.
2. Solo si parece perdido ("y ahora", "qué sigue", "no entiendo", "?"), dile en una frase en qué paso va y qué viene ("Vamos en el paso 4, Tu agente; después investigo y te muestro la propuesta"). Si solo dijo "sí" u "ok" a tu pregunta, no hables de pasos: guarda y sigue.
3. Si todavía falta algo suyo, pregúntalo con tu opción recomendada ya puesta ("Te propongo X. ¿Lo dejo así?"). Debajo del chat aparecen botones con las respuestas.
Nunca repitas una pregunta con las mismas palabras: si no la contestó, propón tú una respuesta concreta. Nunca digas que su mensaje se cortó.`;

const PROFILE_PROPS: Record<string, unknown> = {
  businessName: { type: "string" },
  ownerName: { type: "string", description: "The person's first name, only if they said it" },
  city: { type: "string" },
  zip: { type: "string", description: "Only in the US: 5-digit ZIP code where they are based (local services)" },
  state: { type: "string", description: "Only in the US: 2-letter state code, e.g. FL" },
  country: { type: "string", description: "Two-letter ISO country code where they live or work, deduced from the city: US, MX, CO, ES, AR, PE, CA, GB…" },
  region: { type: "string", description: "Outside the US: their state, province or region, as they said it (e.g. Antioquia, Jalisco, Cataluña)" },
  radiusMiles: { type: "number", description: "Local services: how far they travel from their city, in miles (convert km if they said km)" },
  serviceMode: {
    type: "string",
    enum: ["local", "remote"],
    description: "local = done in person in an area (cleaning, moving, repairs, beauty at home). remote = can be done online from anywhere (video editing, design, bookkeeping, tutoring online).",
  },
  remoteScope: {
    type: "string",
    enum: ["us", "state", "world"],
    description: "Remote only: customers anywhere in their own country (us = their whole country, whatever the country), only in their own state or region (state: the service depends on that region's rules; save it too) or also in other countries (world)",
  },
  languages: { type: "string", enum: ["es", "en", "both"] },
  yearsExperience: { type: "number", description: "Years doing this work in total (may include working for others)" },
  yearsOwnBusiness: { type: "number", description: "Of those, years running their own business (0 if just starting on their own)" },
  mainService: { type: "string" },
  exampleJob: { type: "string" },
  typicalCustomer: { type: "string" },
  howGetsClients: { type: "string" },
  focus: { type: "string", description: "A only: the work they want MORE of, in their words (what they do best or what pays best, e.g. 'restauración de zapatos y bolsos de cuero'). If they offer one single thing, the same as mainService" },
  area: { type: "string", description: "The neighborhood or part of town they work in, only if they said it (e.g. 'Laureles')" },
  currentPrice: { type: "string", description: "What they charge today, exactly as they said it, with every price they gave and its unit (e.g. 'zapatos desde 120.000; bolsos 150.000 a 250.000')" },
  noPrice: { type: "boolean", description: "true only when you asked what they charge and they have no price to give ('depende', 'no sé', 'lo cotizo en el momento')" },
  costs: { type: "string" },
  differentiators: { type: "string" },
  licenseStatus: { type: "string", enum: ["has", "no", "not_needed"] },
  licenseNote: { type: "string", description: "Which license / certification, if any" },
  insured: { type: "string", enum: ["yes", "no"] },
  workLocation: {
    type: "string",
    enum: ["own_place", "client_place", "online", "both"],
    description: "Where the work happens, as the owner chose it: own_place = at their own place/kitchen/shop (and they deliver or the client comes); client_place = at the client's home or business; online; both",
  },
  offerWanted: { type: "string", description: "Only if the owner asked for a discount or offer: what they want, in their words (e.g. '10% off the first class for new students')" },
  direction: {
    type: "string",
    enum: ["known", "new", "open"],
    description: "B only: known = something tied to what they already know or have done; new = something new they can learn (no experience needed); open = either. 'No tengo experiencia' / 'quiero probar algo nuevo' = new",
  },
  workPlace: {
    type: "string",
    enum: ["home", "out", "any"],
    description: "B only: home = from home with a computer or phone; out = in person, at customers' places or on the street; any = either",
  },
  ideasNow: {
    type: "boolean",
    description: "B only: true when the person asks you for ideas or options now ('dame ideas', 'dime qué servicios puedo ofrecer') instead of answering more questions",
  },
  workHistory: { type: "string", description: "B: jobs they have had or what they know how to do ('ninguno' if they said none)" },
  askedFor: { type: "string" },
  tools: { type: "string" },
  hasVehicle: { type: "string", enum: ["yes", "no"] },
  hoursPerWeek: { type: "number", description: "Only a number the person said. 'Medio tiempo' / 'part time' is not a number: ask how many hours" },
  costHoursPerJob: { type: "number", description: "Hours one job takes them (or one client a month for a monthly service), exactly as they said it" },
  costMaterialsUsd: { type: "number", description: "Money spent on materials or tools per job (or per client a month), the number as they said it in their own currency; 0 if they said free / nothing" },
  startBudgetUsd: { type: "number", description: "Money they have to start, the number as they said it (in their currency)" },
  likes: { type: "string", description: "B: what they enjoy doing or are good at, in their words" },
  notWant: { type: "string", description: "What they hate or NEVER want to do again, in their words ('nada en especial' if they said there is nothing). It only excludes: never turn it into an idea" },
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
const START_RESEARCH: Tool = {
  name: "start_research",
  description: "You know enough to research their market and build the strategy (or ideas): start the research now. Call it as soon as the state says canResearch is true and more questions wouldn't change the strategy.",
  input_schema: { type: "object", properties: {} },
};
const CHOOSE_IDEA: Tool = {
  name: "choose_idea",
  description: "The person picked one of the ideas shown (by its number).",
  input_schema: { type: "object", properties: { number: { type: "integer", minimum: 1, maximum: 10 } }, required: ["number"] },
};
const MORE_IDEAS: Tool = {
  name: "more_ideas",
  description: "None of the ideas convinces the person, or they want more to compare: search for different ones, taking their feedback into account.",
  input_schema: {
    type: "object",
    properties: { feedback: { type: "string", description: "What they didn't like and what they'd prefer, in their words" } },
    required: ["feedback"],
  },
};
const OWN_IDEA: Tool = {
  name: "own_idea",
  description: "The person wants their own idea instead of the ones proposed: save it as the chosen idea.",
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
      firstSteps: { type: "array", items: { type: "string" } },
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
      businessName: { type: "string", description: "The business name the owner chose or gave (only then)" },
      languages: { type: "string", enum: ["es", "en", "both"], description: "Only when the owner says which languages they serve customers in" },
      resolvedWarnings: { type: "array", items: { type: "string" }, description: "Exact text of 'keep in mind' warnings the conversation already resolved: they are removed" },
      growth: {
        type: "object",
        description: "A (more clients): the plan to get more clients. Send only the fields that change",
        properties: {
          diagnosis: { type: "string", description: "Why more clients don't come yet, 2-3 sentences" },
          idealClient: { type: "string", description: "Who to sell to first and why" },
          priceVsMarket: { type: "string", description: "Their price against the local market range, honest; never a new price without their OK" },
          actions: { type: "array", items: { type: "string" }, description: "Exactly 3 concrete actions for this week" },
        },
      },
      channels: { type: "array", items: { type: "object", properties: { channel: { type: "string" }, why: { type: "string" } }, required: ["channel", "why"] }, description: "Where to reach clients, in priority order (max 4)" },
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

// Texts that can contradict a correction (checked after every edit).
const ALIGN_KEYS = ["service", "serviceIncludes", "serviceExcludes", "steps", "firstSteps", "customer", "problem", "promise", "differentiators", "packages", "pricingNote", "faq", "videoScript"];

const FIELD_BLOCK: Record<string, ApprovalBlock> = {
  service: "service",
  serviceIncludes: "service",
  serviceExcludes: "service",
  steps: "service",
  firstSteps: "service",
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

// A and B: the Brain decides when it knows enough (start_research). C keeps its list.
const brainDecides = (plan: BusinessPlan) => plan.stage === "interview" && plan.mode !== "agent";
// After this many owner replies with the essentials known, the Brain stops
// asking and researches (a person never gets a long interrogation).
const RESEARCH_CAP = 4;
// With the core known (what + where), this many replies is the end of the
// interview no matter what is still unanswered: nobody gets stuck in questions.
const HARD_CAP = 6;
function coreKnown(plan: BusinessPlan): boolean {
  const p = plan.profile;
  const where = Boolean(p.city || p.country);
  return plan.mode === "existing" ? Boolean(p.mainService) && where : Boolean(p.workHistory || p.likes) && where;
}

function stageOf(plan: BusinessPlan): { system: string; tools: Tool[] } {
  if (brainDecides(plan)) return { system: INTERVIEWER + GUIDE, tools: [SAVE_PROFILE, START_RESEARCH] };
  if (plan.stage === "interview" || plan.stage === "ready_check") return { system: INTERVIEWER + GUIDE, tools: [SAVE_PROFILE] };
  if (LOCKED_STAGES.includes(plan.stage)) return { system: INTERVIEWER + GUIDE, tools: [SAVE_PROFILE] };
  if (plan.stage === "choose") return { system: CHOOSER + GUIDE, tools: [CHOOSE_IDEA, MORE_IDEAS, OWN_IDEA] };
  return { system: EDITOR.replace("{TODAY}", today(plan.profile.state, plan.profile.country)) + GUIDE, tools: [UPDATE_PROPOSAL, APPROVE_BLOCKS] };
}

// A and B: what's essential and still missing, whether the research can
// start, and whether it must start now (the cap on questions, in code).
export function interviewGate(plan: BusinessPlan, ownerReplies: number): { essentialMissing: string[]; canResearch: boolean; mustResearchNow: boolean; forceResearch: boolean } {
  const missing = brainDecides(plan) ? missingProfile(plan) : [];
  const essential = ownerReplies >= HARD_CAP && coreKnown(plan) ? [] : missing;
  // A service Sevrii doesn't publish is never researched (honest message instead).
  const can = brainDecides(plan) && essential.length === 0 && !(plan.mode === "existing" && isRestrictedService(plan));
  return { essentialMissing: essential, canResearch: can, mustResearchNow: can && ownerReplies >= RESEARCH_CAP, forceResearch: can && ownerReplies > RESEARCH_CAP };
}

// The web lookup, after the reply is sent (it takes 20 to 40 seconds).
function lookUpLater(b: BusinessRow, plan: BusinessPlan, lang: Lang) {
  const job = () =>
    runForUser(b.userId, async () => {
      const fresh = await runInsights(plan, lang).catch(() => []);
      if (fresh.length) await addPlanInsights(b.id, fresh);
    }, "brain_chat").catch((err) => console.warn("[brain:insights] not saved", (err as { message?: string })?.message));
  try {
    after(job);
  } catch {
    // Outside a request (a script, a test): no background work.
  }
}

// A fact found on the web that no message of the Brain has used yet (its
// source or one of its numbers already said = used).
function unusedInsights(plan: BusinessPlan, saidByBrain: string): { fact: string; source: string }[] {
  const said = saidByBrain.toLowerCase();
  const nums = new Set(everyAmount(saidByBrain));
  return plan.insights
    .filter((i) => !(i.source && said.includes(i.source.toLowerCase())) && !everyAmount(i.fact).some((n) => n >= 100 && nums.has(n)))
    .map((i) => ({ fact: i.fact, source: i.source }));
}

function state(b: BusinessRow, ownerReplies = 0, saidByBrain = "") {
  const p = b.plan;
  const base = {
    stage: p.stage,
    mode: p.mode === "new" ? "B: starting a new service" : p.mode === "agent" ? "C: an AI agent that delivers the service by itself" : "A: already offers a service",
    today: today(p.profile.state, p.profile.country),
  };
  if (brainDecides(p)) {
    // A cap in code, not only in the prompt: with what's essential known, a
    // few replies are enough; past that the research starts.
    const g = interviewGate(p, ownerReplies);
    return { ...base, profile: p.profile, newFacts: unusedInsights(p, saidByBrain).slice(0, 2), essentialMissing: g.essentialMissing, canResearch: g.canResearch, mustResearchNow: g.mustResearchNow, ownerReplies };
  }
  if (p.stage === "interview" || p.stage === "ready_check") {
    const idea = p.chosenIdea !== null ? p.ideas[p.chosenIdea] : null;
    const missing = missingProfile(p);
    // One question at a time: the model only gets the next thing to ask.
    return { ...base, missing: missing.slice(0, 1), stillToAskAfterThis: Math.max(0, missing.length - 1), profile: p.profile, ...(idea ? { chosenIdea: idea } : {}) };
  }
  if (p.stage === "choose")
    return { ...base, ideas: p.ideas.map((i, n) => ({ number: n + 1, ...i })), rejectedBefore: p.rejectedIdeas.slice(-80), roundsLeft: Math.max(0, MAX_IDEA_ROUNDS - p.ideaRounds) };
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
      ...(p.mode === "existing" ? { growth: p.growth, channels: p.channels } : {}),
      offer: p.offer,
      noOffer: p.noOffer,
      faq: p.faq,
      ...(p.mode === "agent" ? { agent: p.agent } : {}),
    },
    warnings: p.guard.warn,
    approvals: p.approvals,
    notApprovedYet: APPROVAL_BLOCKS.filter((x) => !p.approvals[x]),
    currentPart: p.stage !== "proposal" ? "none (approved)" : oneConfirmation(p) ? "the whole strategy at once (one Confirm button)" : (APPROVAL_BLOCKS.find((x) => !p.approvals[x]) ?? "all approved"),
    ...(p.mode !== "agent" ? { unknownAnswers: unknownCards(p.mode, p.cards), cards: p.cards } : {}),
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
    // A and B confirm the whole strategy: a part with nothing in it never blocks.
    // C: an empty part can't be approved, and it says why (it used to skip in
    // silence, so the same card came back after every "Aprobar").
    if (!blockHasContent(next, blk) && !oneConfirmation(plan)) {
      refused.push(
        lang === "es"
          ? `«${partName(blk, lang)}» todavía está vacía: dime qué debe decir (o pídeme que la arme) y luego la apruebas.`
          : `"${partName(blk, lang)}" is still empty: tell me what it should say (or ask me to write it) and then approve it.`
      );
      continue;
    }
    approvals[blk] = true;
  }
  next = { ...next, approvals };
  if (allApproved(next)) {
    const g = codeGuard(next, lang, true);
    if (g.block.length) {
      refused.push(...g.block);
      next = { ...next, guard: { ...next.guard, block: g.block } };
    } else {
      next = { ...readyForPage(next), stage: "approved", ready: true, approvedAt: today(next.profile.state, next.profile.country), guard: { block: [], warn: next.guard.warn } };
    }
  }
  return { plan: parsePlan(next), refused };
}

// Placeholders the model sometimes saves as a business name.
const NO_NAME = /^(sin nombre|no tengo|todav[ií]a no|a[uú]n no|ninguno|ninguna|n\/?a|none|no name|not yet|no tiene|sin nombre todav[ií]a|por definir|tbd|-+)\b/i;
const fold = (x: string) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// A plain yes to the Brain's last proposal ("sí, está bien", "dale", "ok").
const SAID_YES = /^\s*(si|ok|okay|dale|esta bien|me parece|de acuerdo|perfecto|listo|claro|va|bueno|yes|yep|sure|sounds good|that works|fine)\b/;
// The owner asks for ideas instead of more questions.
const ASKS_IDEAS = /\b(ideas?|opciones|options|dime (buenos |algunos |que )?servicios|que (servicios? )?(puedo|podria) (hacer|ofrecer)|recomiendame|recomienda(me)?|sugiere(me)?|sugerencias|give me|what can i (do|offer)|suggest)\b/;

// Did the owner actually talk about languages? (the model sometimes guesses
// them from the language they write in, or from "Hispanic customers").
const SAID_LANGUAGES = /\b(espa[ñn]ol|ingl[eé]s|spanish|english|idiomas?|languages?|biling[uü]e|bilingual|ambos|los dos|both)\b/i;
// "Atiendo en inglés y español" / "solo español" / "only English" → what they said.
export function saidLanguages(text: string): "es" | "en" | "both" | null {
  const t = text.toLowerCase();
  const es = /espa[ñn]ol|spanish/.test(t);
  const en = /ingl[eé]s|english/.test(t);
  if (/biling[uü]e|bilingual/.test(t) || (es && en && !/\b(no|sin|nada de|not|no hablo|don'?t)\s+(\w+\s+){0,2}(ingl[eé]s|english|espa[ñn]ol|spanish)/.test(t))) return "both";
  if (/\b(solo|s[oó]lamente|only|just)\b/.test(t) && es && !en) return "es";
  if (/\b(solo|s[oó]lamente|only|just)\b/.test(t) && en && !es) return "en";
  return null;
}

// A profile that was completed while the owner was over their research limit
// stays in the interview. Once research can start (new month, a higher plan,
// a tester account) it moves on by itself: the old limit message is corrected
// so the chat never ends on a dead end. Returns the updated business, or null.
const LIMIT_MSG = /(l[ií]mite de este mes|l[ií]mite de tu plan|investigaciones de tu plan|research limit|limit for this month|research runs in your plan|presupuesto de IA|AI budget)/i;
export async function resumeStuckResearch(b: BusinessRow, lang: Lang): Promise<BusinessRow | null> {
  const plan = b.plan;
  if (plan.stage !== "interview" && plan.stage !== "ready_check") return null;
  if (!profileComplete(plan)) return null;
  if (!(await researchWouldStart(b.userId))) return null;
  const stage: PlanStage = plan.stage === "interview" && (plan.mode === "new" || plan.mode === "agent") ? "ideas_research" : "research";
  await updateBusinessPlan(b.id, parsePlan({ ...plan, stage, runId: "", flowLang: plan.flowLang || (lang === "en" ? "en" : "es") }));
  const es = lang !== "en";
  const recent = (await listChatMessages(b.id, "plan")).slice(-8);
  for (const m of recent) {
    if (m.role !== "user" && LIMIT_MSG.test(m.content) && !m.content.includes("[[")) {
      await updateChatMessage(b.id, m.id, es ? "Quedó guardado todo tu perfil. (Aquí había un aviso de límite que ya no aplica: tu plan permite seguir.)" : "Your whole profile is saved. (There was a limit notice here that no longer applies: your plan lets you continue.)");
    }
  }
  await addChatMessage(b.id, "plan", "ai", es ? "Ya puedo seguir: empiezo a investigar ahora (unos minutos). Verás el avance aquí en el chat." : "I can keep going now: starting the research (a few minutes). You'll see the progress here in the chat.");
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

// "Actualizo / cambié / quité…": a sentence that says an edit was made.
const CLAIMS_EDIT = /\b(actualiz\w*|cambi[eé]|lo cambio|los cambio|quit[eé]|quito|corrig\w*|ajust[eé]|ajusto|agregu[eé]|agrego|ya qued[oó]|listo, (ya|lo)|updated?|changed|removed|fixed|added)\b/i;

// Rules that must hold on every turn, re-sent with each message so a long
// chat never loses them (the code checks them too).
const HARD_RULES = `(Reglas de siempre: lenguaje neutro de género (nunca «ubicada», «lista», «contenta», «ubicado», «listo» para la persona: di «tu zona ya quedó guardada», «ya tengo lo que necesito»); nunca expliques qué puede o no guardar el sistema (si un dato necesita confirmación, pregunta "¿lo dejo en X?"); ningún descuento que el dueño no pidió; una sola pregunta por mensaje; guarda números solo si la persona los dijo, nunca conviertas "medio tiempo" u otra respuesta vaga en un número; no cambies precios sin su OK explícito; responde primero lo que pregunta, con otras palabras si no entendió; nada de notas internas, nombres de campos ni "expediente"; no pidas seguros ni permisos que no sean indispensables, y si ya lo preguntaste una vez no vuelvas a preguntarlo; nunca preguntes algo que ya está en "Datos ya confirmados"; lo que la persona odia o nunca quiere volver a hacer solo se excluye: jamás lo propongas ni lo pongas de ejemplo; nunca le atribuyas a la persona algo que escribió el sistema; no cambies cómo ni dónde se hace el servicio sin su permiso.)`;

// Notary, immigration paperwork, loans, credit repair: said honestly, with
// the way out (the screen shows the same card with its buttons).
const RESTRICTED_NOTE = (mode: "existing" | "new") =>
  `not started: Sevrii doesn't publish this kind of service for now (notary, immigration paperwork, loans or credit repair: heavily regulated, special licenses). Tell the owner kindly and honestly in 2 short lines, never suggest renaming it to get around it, ${mode === "existing" ? "and say that if they offer another service they can create a new project with it (the card under your message has the button)" : "and offer to look for other service ideas with what they already told you (the card under your message has the button «Ver otros servicios»)"}. Ask nothing else.`;

// The price question, and the answers that mean "I have no fixed price".
const ASKS_PRICE = /(cu[aá]nto (cobras|cuesta|vale|pides)|qu[eé] (cobras|precio)|tus? precios?|cobras hoy|how much do you charge|what do you charge|your prices?|your rate)/i;
const NO_PRICE = /(depende|no se\b|no tengo (un )?precio|sin precio|cotiz|segun|varia|it depends|no fixed|i quote|not sure|dont know|don't know)/;

// What save_profile keeps of what the model sent, checked in code: numbers
// the owner really said, free text in their own words, no offer they didn't
// ask for, the place settled (country deduced, no US state abroad) and a
// change of service. Pure (the caller saves it).
export function applyProfileInput(plan: BusinessPlan, inputIn: Record<string, unknown>, ownerSaid: string, lastSaid: string, lastAssistant: string): { next: BusinessPlan; note: string } {
  const input = { ...inputIn };
  let note = "";
  if (input.languages !== undefined && !SAID_LANGUAGES.test(ownerSaid)) {
    delete input.languages;
    note = " (languages NOT saved: the owner never said which languages they serve in; ask them: español, inglés o los dos)";
  }
  // A number is saved only if the owner said it ("medio tiempo" is not 20
  // hours), or if the Brain proposed it and the owner just said yes to it.
  const agreed = SAID_YES.test(fold(lastSaid));
  for (const [k, rule] of Object.entries(OWNER_NUMBERS)) {
    if (input[k] === undefined || input[k] === null) continue;
    const n = Number(input[k]);
    // "20 km" saved as 12 miles is still what they said (the field is in miles).
    const fromKm = k === "radiusMiles" && numbersIn(ownerSaid).some((x) => /km|kil[oó]metro/i.test(ownerSaid) && Math.abs(x * 0.621371 - n) <= 1);
    const ok = Number.isFinite(n) && (ownerStated(n, ownerSaid, rule.zeroOk) || fromKm || (agreed && ownerStated(n, lastAssistant)));
    if (!ok) {
      delete input[k];
      note += ` (${k} NOT saved: the owner never said or agreed to that number. Ask them ${rule.ask}, with a typical number they can accept; never assume it, and never mention a system or a rule to them)`;
    }
  }
  // Free-text answers come from the owner's own words, never from a guess.
  for (const k of ["likes", "notWant", "workHistory", "askedFor", "focus", "area"] as const) {
    const v = input[k];
    if (typeof v === "string" && v.trim() && !groundedInOwner(v, ownerSaid)) {
      delete input[k];
      note += ` (${k} NOT saved: the owner didn't say that. Ask them again with other words and 2 or 3 options they can pick; never fill it in yourself and never mention a system)`;
    }
  }
  // Their price is theirs: saved only when at least one of its amounts is a
  // number they wrote ("120 mil" and "120.000" are the same amount).
  if (typeof input.currentPrice === "string" && input.currentPrice.trim()) {
    const am = everyAmount(input.currentPrice);
    const said = new Set([...everyAmount(ownerSaid), ...numbersIn(ownerSaid)]);
    if (am.length && !am.some((n) => said.has(n))) {
      delete input.currentPrice;
      note += " (currentPrice NOT saved: the owner never wrote that amount. Ask what they charge today, in numbers; never guess it)";
    }
  }
  // "No tengo precio fijo" is an answer to the price question, not a way to skip it.
  if (input.noPrice === true && !(ASKS_PRICE.test(lastAssistant) || NO_PRICE.test(fold(lastSaid)))) {
    delete input.noPrice;
    note += " (noPrice NOT saved: you haven't asked what they charge yet. Ask it)";
  }
  // An offer exists only if the owner asked for one.
  if (typeof input.offerWanted === "string" && input.offerWanted.trim() && !ASKS_OFFER.test(ownerSaid)) {
    delete input.offerWanted;
    note += " (offerWanted NOT saved: the owner never asked for a discount or offer; don't suggest one)";
  }
  // "Give me ideas" is the owner's call, not the model's guess.
  if (input.ideasNow === true && (plan.mode !== "new" || !ASKS_IDEAS.test(fold(ownerSaid)))) {
    delete input.ideasNow;
    note += " (ideasNow NOT saved: they did not ask for ideas; keep the interview going)";
  }
  // "No tengo nombre" is not a name: the Brain suggests some instead.
  if (typeof input.businessName === "string" && NO_NAME.test(input.businessName.trim())) {
    delete input.businessName;
    note += " (businessName NOT saved: they have no name yet. In THIS message suggest 2 or 3 short names that fit their service and city and ask which one they like)";
  }
  // The country is deduced in code too (Medellín → CO, Madrid → ES), and a
  // US state or ZIP never sticks to a city in another country.
  const profile = settlePlace(parseProfile({ ...plan.profile, ...input }), lastSaid, typeof input.country === "string" && input.country.trim() !== "");
  let next: BusinessPlan = { ...plan, profile };
  // A change of mind: the new service replaces the chosen idea everywhere
  // (research, proposal and page), so nothing of the old one is left.
  const chosen = plan.chosenIdea !== null ? plan.ideas[plan.chosenIdea] : null;
  if (typeof input.mainService === "string" && profile.mainService && (plan.service || chosen) && fold(profile.mainService) !== fold(plan.service || chosen?.title || "")) {
    next = { ...next, service: profile.mainService, chosenIdea: null };
    note += ` (the service is now "${profile.mainService}": from now on talk only about it; the previous idea is gone)`;
  }
  return { next, note };
}

async function runTool(name: string, input: Record<string, unknown>, b: BusinessRow, lang: Lang, ownerSaid = "", lastSaid = "", lastAssistant = "", turn: { approved: boolean; force?: boolean } = { approved: false }): Promise<{ out: string; startPipeline?: boolean }> {
  const plan = b.plan;
  switch (name) {
    case "save_profile": {
      if (plan.stage !== "interview" && plan.stage !== "ready_check") return { out: "error: not in the interview" };
      const applied = applyProfileInput(plan, input, ownerSaid, lastSaid, lastAssistant);
      const note = applied.note;
      let next = applied.next;
      const profile = next.profile;
      if (profile.businessName && profile.businessName !== plan.profile.businessName) await renameProject(b, profile.businessName);
      const left = missingProfile(next);
      // A and B: the Brain decides when to research (start_research), never a list.
      if (brainDecides(next)) {
        await updateBusinessPlan(b.id, parsePlan(next));
        if (next.mode === "existing" && isRestrictedService(next)) return { out: `saved${note}. ${RESTRICTED_NOTE("existing")}` };
        // Real facts for the conversation: one web lookup when the Brain first
        // knows what they do and where, and one more when it learns what they
        // want more of. It runs in the background, after this reply (the person
        // never waits for a search); what it finds is in the state of the next
        // message. Only while questions are left.
        const second = next.mode === "existing" && Boolean(next.profile.focus) && !plan.profile.focus;
        if (left.length && canLookUp(next) && (next.insightRuns === 0 || (next.insightRuns === 1 && second))) {
          next = { ...next, insightRuns: next.insightRuns + 1 };
          await updateBusinessPlan(b.id, parsePlan(next));
          lookUpLater(b, next, lang);
        }
        return { out: `saved${note}. canResearch: ${left.length ? `no (still essential: ${left.join(", ")})` : "yes (call start_research as soon as more questions wouldn't change the strategy)"}.` };
      }
      // B's chosen idea is a service Sevrii doesn't publish: no research on it.
      if (next.mode === "new" && next.stage === "ready_check" && isRestrictedService(next)) {
        await updateBusinessPlan(b.id, parsePlan(next));
        return { out: `saved${note}. ${RESTRICTED_NOTE("new")}` };
      }
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
      next = { ...next, stage, runId: "", flowLang: next.flowLang || (lang === "en" ? "en" : "es") };
      await updateBusinessPlan(b.id, parsePlan(next));
      return { out: `saved${note}. profile complete: stage moved to ${stage}. Tell the owner you will now research their area (a few minutes) and they will see the progress here in the chat. Do NOT ask any question now: the chat is locked during the research.`, startPipeline: true };
    }
    case "start_research": {
      if (!brainDecides(plan)) return { out: "error: not in the interview" };
      // A service Sevrii doesn't publish: no research run is spent on it, and
      // the person hears it now (not after 2 minutes, on the proposal).
      if (plan.mode === "existing" && isRestrictedService(plan)) return { out: RESTRICTED_NOTE("existing") };
      // Past the hard cap the code starts it with what there is (turn.force).
      const left = turn.force ? [] : missingProfile(plan);
      if (left.length) return { out: `not started: still essential: ${left.join(", ")}. Ask only that, in one line.` };
      // The research, the proposal and the page's fixed labels follow the
      // language this flow runs in (it used to be set only by the old cards).
      const next: BusinessPlan = { ...plan, profile: { ...plan.profile, researchReady: true }, flowLang: plan.flowLang || (lang === "en" ? "en" : "es") };
      const stage: PlanStage = plan.mode === "new" ? "ideas_research" : "research";
      if (!(await researchWouldStart(b.userId))) {
        await updateBusinessPlan(b.id, parsePlan(next));
        const msg = researchLimitText(await researchUsage(b.userId), lang === "en" ? "en" : "es");
        return { out: `the research can't start now. Tell the owner kindly, with these exact facts and nothing else about plans (don't suggest upgrading unless this text does): "${msg}"` };
      }
      await updateBusinessPlan(b.id, parsePlan({ ...next, stage, runId: "" }));
      return { out: `research started (stage ${stage}). Tell the owner you will now research their area (a few minutes) and they will see the progress here in the chat${plan.mode === "new" ? ", and then the 3 best service ideas first (and more if they want)" : ""}. Do NOT ask any question now: the chat is locked during the research.`, startPipeline: true };
    }
    case "choose_idea": {
      if (plan.stage !== "choose") return { out: "error: not choosing ideas now" };
      const i = Number(input.number) - 1;
      const idea = plan.ideas[i];
      if (!idea) return { out: "error: unknown idea" };
      return afterChoice(b, chooseIdea(plan, i), lang, idea.title);
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
        return { out: "evaluating their idea with the same research (a few minutes). Tell them in one line you'll check their idea against what people pay and need, and show it here next to 2 alternatives.", startPipeline: true };
      }
      const own = parseIdeas([{ title, why: str(input.what, 800), what: str(input.what, 400) }])[0];
      const ideas = [...plan.ideas.slice(0, 9), own];
      return afterChoice(b, chooseIdea({ ...plan, ideas }, ideas.length - 1), lang, `their own idea, ${title}`);
    }
    case "more_ideas": {
      if (plan.stage !== "choose") return { out: "error: not choosing ideas now" };
      if (plan.ideaRounds >= MAX_IDEA_ROUNDS) return { out: "error: no more idea rounds; help them pick or describe a service they want" };
      if (!(await researchWouldStart(b.userId, { budgetOnly: true })))
        return { out: `error: no new search now. Facts to tell them (don't suggest upgrading unless this text does): "${researchLimitText(await researchUsage(b.userId), lang === "en" ? "en" : "es")}". Their ideas are still here: help them pick one.` };
      await updateBusinessPlan(b.id, requestMoreIdeas(plan, str(input.feedback, 300)));
      return { out: "searching new ideas. Tell them in one line you're looking for different options with what they said (a few minutes) and they'll see them here in the chat.", startPipeline: true };
    }
    case "update_proposal": {
      if (plan.stage !== "proposal" && plan.stage !== "approved") return { out: "error: no proposal yet" };
      const patch: Record<string, unknown> = { ...input };
      // The languages they serve in, when they say so (a correction here is a
      // fact about them, so the final check reads the new one, never the old).
      delete patch.languages;
      const langs = saidLanguages(lastSaid) ?? (typeof input.languages === "string" && SAID_LANGUAGES.test(lastSaid) ? (input.languages as "es" | "en" | "both") : null);
      if (langs && langs !== plan.profile.languages) patch.profile = { ...plan.profile, languages: langs };
      // The name is the owner's: saved only when they wrote it or picked one we suggested.
      let nameNote = "";
      if (typeof input.businessName === "string") {
        const name = str(input.businessName, 80);
        delete patch.businessName;
        const said = fold(lastSaid);
        if (name && !NO_NAME.test(name) && (said.includes(fold(name)) || (fold(lastAssistant).includes(fold(name)) && lastSaid.trim().length <= 80))) {
          patch.profile = { ...((patch.profile as BusinessPlan["profile"] | undefined) ?? plan.profile), businessName: name };
          await renameProject(b, name);
          nameNote = `; business name saved: ${name}`;
        } else nameNote = "; business name NOT saved: the owner didn't give or pick it";
      }
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
      if (input.growth && typeof input.growth === "object") patch.growth = { ...plan.growth, ...(input.growth as Record<string, unknown>) };
      // Offers are the owner's call: one is added only when they ask for it
      // (their words become the offer they want). Removing one is always fine.
      let offerNote = "";
      if (input.offer && typeof input.offer === "object" && input.noOffer !== true) {
        if (ASKS_OFFER.test(lastSaid)) patch.profile = { ...((patch.profile as BusinessPlan["profile"] | undefined) ?? plan.profile), offerWanted: str(lastSaid, 300) };
        else if (!plan.profile.offerWanted) {
          delete patch.offer;
          delete patch.noOffer;
          offerNote = "; offer NOT added: the owner never asked for a discount or offer (never suggest one)";
        }
      }
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
      // One correction, every part: the texts that still say the old thing
      // are rewritten too, so the owner never repeats a correction.
      if (Object.keys(patch).some((k) => ALIGN_KEYS.includes(k)) && !isQuestionTurn(lastSaid)) {
        const draft = parsePlan({ ...plan, ...patch }) as unknown as Record<string, unknown>;
        const extra = await alignProposal(draft as unknown as BusinessPlan, lastSaid, lang);
        for (const [k, v] of Object.entries(extra)) {
          const now = (parsePlan({ ...draft, [k]: v }) as unknown as Record<string, unknown>)[k];
          if (JSON.stringify(now) === JSON.stringify(draft[k])) continue;
          patch[k] = v;
          if (FIELD_BLOCK[k]) touched.add(FIELD_BLOCK[k]);
        }
      }
      const approvals = { ...plan.approvals };
      for (const t of touched) delete approvals[t];
      // Only an edit to an approval block reopens the proposal; anything else
      // (video script, photo ideas…) keeps the stage as it was.
      const reopen = touched.size > 0;
      let next = parsePlan({ ...plan, ...patch, approvals, ...(reopen ? { stage: "proposal", ready: false } : {}) });
      // A price is the owner's only if they said it; the rest stay market references.
      next = withoutAvoided(noFakeCosts(markReferencePrices(next, ownerSaid)));
      // A (more clients): a new price nobody gave and the research didn't find
      // is not shown; and no language the owner never said.
      if (patch.packages) next = dropUnbackedRefs(next);
      next = noLanguageClaims(next);
      // Invented amounts or hours, or internal words, never reach the owner.
      // (Only problems this edit brings in: an older proposal is never blocked.)
      const had = new Set(silentProposalIssues(plan, ownerSaid));
      const silent = silentProposalIssues(next, ownerSaid).filter((x) => !had.has(x));
      if (silent.length) return { out: `error: NOTHING was saved (don't tell the owner you changed it). Fix it and send it again: ${silent.join(" ")}` };
      const g = codeGuard(next, lang, false);
      next = { ...next, guard: { block: g.block, warn: warnLeft } };
      // Everything still approved (nothing to re-approve): finish it again.
      if (next.stage === "proposal" && allApproved(next)) next = applyApprovals(next, [], lang).plan;
      await updateBusinessPlan(b.id, next);
      const gone = plan.guard.warn.length - warnLeft.length;
      return { out: `saved. blocks that need approval again: ${[...touched].join(", ") || "none"}${gone ? `; ${gone} warning(s) removed` : ""}${g.block.length ? `; problems: ${g.block.join(" ")}` : ""}${offerNote}${nameNote}` };
    }
    case "approve_blocks": {
      if (plan.stage !== "proposal") return { out: "error: nothing to approve" };
      if (!saidApproval(lastSaid))
        return { out: "not approved: the owner did not explicitly approve this part (asking to continue is not an approval). Nothing changed. Tell them in one line that to go on they approve this part with the card's \"Aprobar\" button (or tell you it's approved), or say what to change." };
      // A and B confirm the whole strategy at once.
      if (oneConfirmation(plan)) {
        const { plan: done, refused: no } = applyApprovals(readyForPage(plan), APPROVAL_BLOCKS, lang);
        await updateBusinessPlan(b.id, done);
        if (done.stage !== "approved") return { out: `not approved yet: ${no.join(" ") || "try again"}` };
        turn.approved = true;
        // The approval is saved: a page that can't be built now is built from Store.
        const filled = (await fillStoreFromPlan(b.id, lang, { onlyIfEmpty: true }).catch(() => ({ filled: false }))).filled;
        return { out: `all approved: ${await pageNote(b.id, filled)}` };
      }
      let blocks = (Array.isArray(input.blocks) ? input.blocks : []).filter((x): x is ApprovalBlock => APPROVAL_BLOCKS.includes(x as ApprovalBlock));
      // One OK approves the part being reviewed, nothing more, unless they say "todo".
      const current = APPROVAL_BLOCKS.find((x) => !plan.approvals[x]);
      const all = /\b(todo|todas|todos|everything|all (of it|parts))\b/i.test(lastSaid);
      if (!all) blocks = blocks.filter((x) => x === current);
      // One message approves one part: a second approval in the same turn needs "todo".
      if (!all && turn.approved) return { out: "not approved: this message already approved the part that was being reviewed. The next part needs its own OK. Do not call approve_blocks again in this turn." };
      if (!blocks.length) return { out: "not approved: only the part being reviewed can be approved with this OK, and they didn't say it was approved. Nothing changed. Show it again briefly and ask if they approve this part or what to change." };
      const { plan: next, refused } = applyApprovals(plan, blocks, lang);
      if (!refused.length) turn.approved = true;
      await updateBusinessPlan(b.id, next);
      const built = next.stage === "approved" ? (await fillStoreFromPlan(b.id, lang, { onlyIfEmpty: true }).catch(() => ({ filled: false }))).filled : false;
      return { out: `${next.stage === "approved" ? `all approved: ${await pageNote(b.id, built)}` : "approved"}${refused.length ? `; not approved: ${refused.join(" ")}` : ""}` };
    }
    default:
      return { out: "error: unknown tool" };
  }
}

// What the page really has after an approval, said to the model so it never
// claims a rebuild that didn't happen (a page the owner already had is never
// rewritten: Store offers «Actualizar mi página»).
async function pageNote(businessId: string, filled: boolean): Promise<string> {
  const fresh = await getBusinessById(businessId);
  const hasPage = (await listServices(businessId).catch(() => [])).length > 0 || Boolean(fresh?.site.headline);
  const st = pageState(filled, hasPage, fresh);
  return st === "built"
    ? "the store page has exactly what was approved. Tell them in one line that Store is open to review it."
    : st === "stale"
      ? "their page already existed and was NOT changed: it still shows the earlier version. Tell them in one line to open Store and tap \"Actualizar mi página\" to bring in the changes. Never say the page was rebuilt."
      : "the page isn't built yet. Tell them in one line that Store is open to create their page.";
}

// After picking an idea (B): straight to the research when nothing essential is
// missing; otherwise the one thing left is asked (or deduced from the idea).
async function afterChoice(b: BusinessRow, next: BusinessPlan, lang: Lang, title: string): Promise<{ out: string; startPipeline?: boolean }> {
  await updateBusinessPlan(b.id, parsePlan(next));
  if (next.mode === "new" && isRestrictedService(next)) return { out: `chosen: ${title}, but ${RESTRICTED_NOTE("new")}` };
  if (next.mode === "agent" || missingProfile(next).length) return { out: `chosen: ${title}. Now ask only what's in "missing" (deduce it from the idea and save it if it's obvious).` };
  if (!(await researchWouldStart(b.userId))) {
    const msg = researchLimitText(await researchUsage(b.userId), lang === "en" ? "en" : "es");
    return { out: `chosen: ${title}, but the research can't start now. Tell the owner kindly, with these exact facts: "${msg}"` };
  }
  await updateBusinessPlan(b.id, parsePlan({ ...next, stage: "research", runId: "" }));
  return { out: `chosen: ${title}. Research started (a few minutes). Tell the owner in one line you're researching prices and customers for it in their area. Do NOT ask any question now.`, startPipeline: true };
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
  // B: a clearly digital or in-person idea says how it's delivered. Without
  // this, someone who answered "digital" on the cards and then picked an
  // in-person idea was researched nationwide, as an online service.
  const serviceMode = plan.mode === "new" && idea.delivery === "digital" ? "remote" : plan.mode === "new" && idea.delivery === "fisico" ? "local" : plan.profile.serviceMode;
  return parsePlan({
    ...plan,
    chosenIdea: i,
    stage: "ready_check",
    service: idea.title,
    profile: { ...plan.profile, mainService: idea.title, serviceMode },
  });
}

export type BrainChatResult = { reply: string; business: BusinessRow; startPipeline: boolean; debug?: string };

export async function runPlanChatTurn(opts: {
  business: BusinessRow;
  history: { role: "user" | "assistant"; content: string }[];
  // The whole chat (the model sees only the last messages; the checks in code see all of it).
  fullHistory?: { role: "user" | "assistant"; content: string }[];
  message: string;
  lang: Lang;
}): Promise<BrainChatResult> {
  let business = opts.business;
  const es = opts.lang === "es";
  if (LOCKED_STAGES.includes(business.plan.stage)) {
    // "Estoy investigando" only while it really is: a research that stopped
    // (a failed step) or that the plan's limit won't let start says so.
    const p = business.plan;
    const jobs = await latestResearchRun(business.id).catch(() => []);
    const current = jobs.length > 0 && jobs[0].runId === p.runId;
    const stopped = current && jobs.some((j) => j.status === "failed" && (j.kind === "ideas_pick" || j.kind === "strategy" || j.kind === "guard"));
    const blocked = !current && !(await researchWouldStart(business.userId, { budgetOnly: p.stage === "ideas_research" && p.ideaRounds > 0 }).catch(() => true));
    if (stopped || blocked) {
      return {
        reply: stopped
          ? es
            ? "La investigación se detuvo por un error de nuestro lado. Toca «Reintentar» y la sigo donde quedó."
            : "The research stopped because of an error on our side. Tap \"Retry\" and I'll pick it up where it left off."
          : researchLimitText(await researchUsage(business.userId), es ? "es" : "en"),
        business,
        startPipeline: false,
      };
    }
    return {
      reply: es ? "Estoy investigando tu zona. En un momento te muestro lo que encontré." : "I'm researching your area. I'll show you what I found in a moment.",
      business,
      startPipeline: true,
    };
  }
  // A and B: the interview is this conversation (no mandatory cards).
  const client = getBrainModel();
  if (!client) {
    console.error("[ai:brain] MODEL_API_KEY is not set");
    return {
      reply: es ? "El asistente no está disponible en este momento. Inténtalo de nuevo en unos minutos." : "The assistant isn't available right now. Please try again in a few minutes.",
      business,
      startPipeline: false,
    };
  }

  // What the owner wrote in this chat (to check facts the model saves).
  let nameNote = "";
  // The name of the business is the owner's: when the Brain just asked for it
  // and the answer is a name ("redes latinas"), it is saved as they wrote it
  // (capitalized), never swapped for suggestions.
  {
    const p0 = business.plan;
    const next0 = missingProfile(p0)[0] || "";
    const lastAi = [...opts.history].reverse().find((h) => h.role === "assistant")?.content ?? "";
    // "Se llamará Orden Latino" → "Orden Latino": the name without the lead-in.
    const LEAD = /^(?:mi\s+(?:negocio|servicio|empresa)\s+)?(?:se\s+(?:va\s+a\s+)?llam(?:a|ar[aá])|el\s+nombre\s+(?:es|ser[aá])|(?:quiero\s+)?(?:llamarlo|llamarla|que\s+se\s+llame)|p[oó]nle|it'?s\s+called|call\s+it|the\s+name\s+is|name\s+it)\s*[:,-]?\s+/i;
    const msg = opts.message.trim().replace(/^["'«“]|["'»”.!]$/g, "").trim().replace(LEAD, "").replace(/^["'«“]|["'»”.!]$/g, "").replace(/\s+(?:por favor|please)$/i, "").trim();
    const words = msg.split(/\s+/).filter(Boolean);
    if (
      (p0.stage === "interview" || p0.stage === "ready_check") &&
      next0.startsWith("businessName") &&
      /nombre|name/i.test(lastAi) &&
      words.length >= 1 && words.length <= 6 && msg.length <= 60 &&
      !/[?¿]/.test(msg) && !NO_NAME.test(msg) &&
      !/^(s[ií]|no|ok|dale|cu[aá]l|el|la|ese|esa|esta|este|the|that|yes)\b/i.test(msg)
    ) {
      const name = words.map((w) => (w.length > 2 || words.indexOf(w) === 0 ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
      const profile = parseProfile({ ...p0.profile, businessName: name });
      await updateBusinessPlan(business.id, parsePlan({ ...p0, profile }));
      await renameProject(business, name);
      business = (await getBusinessById(business.id))!;
      nameNote = `\n\n(Internal note: the owner's business name "${name}" is saved. Call save_profile with businessName "${name}" now to confirm it, and don't suggest other names.)`;
    }
  }
  const mem = opts.fullHistory ?? opts.history;
  const ownerSaid = [...mem.filter((h) => h.role === "user").map((h) => h.content), opts.message].join("\n");
  const lastAssistant = [...opts.history].reverse().find((h) => h.role === "assistant")?.content ?? "";
  const saidByBrain = mem.filter((h) => h.role === "assistant").map((h) => h.content).join("\n");
  const askedSomething = isQuestionTurn(opts.message);
  const ownerReplies = mem.filter((h) => h.role === "user").length + 1;
  // Questions the Brain already asked and the owner already answered (whole chat).
  const answered: { q: string; a: string }[] = [];
  mem.forEach((h, i) => {
    if (h.role !== "assistant") return;
    const a = mem.slice(i + 1).find((x) => x.role === "user")?.content ?? (i === mem.length - 1 ? opts.message : "");
    if (a) for (const q of questionSentences(h.content)) if (q.length >= 12) answered.push({ q, a });
  });
  const repeatOf = (text: string) => {
    for (const q of questionSentences(text)) {
      const hit = answered.find((x) => similar(x.q, q) >= 0.5);
      if (hit) return { q, before: hit };
    }
    return null;
  };
  let retriedRepeat = false;
  const messages: MessageParam[] = [
    ...opts.history.map((h): MessageParam => ({ role: h.role, content: h.content })),
    { role: "user", content: `State (JSON):\n${JSON.stringify(state(business, ownerReplies, saidByBrain))}\n\nOwner: ${opts.message}${nameNote}${LOST.test(opts.message.trim()) ? "\n\n(Internal note: a short or lost reply. Follow the rules for \"ok\" / lost replies: act on your last recommendation, say which step they are on and what comes next.)" : ""}${askedSomething ? "\n\n(Internal note: the owner asked something or didn't understand. Answer exactly that, in simpler words, and don't ask them to approve anything in this message.)" : ""}\n\n(${lockedFacts(business.plan, mem)})\n\n${HARD_RULES}` },
  ];
  let reply = "";
  let startPipeline = false;
  let nudged = false;
  let debug = "";
  // A reply never hangs: each call has a short timeout, and the whole turn a
  // deadline. What the tools saved stays saved; the owner gets an answer.
  const started = Date.now();
  const TURN_DEADLINE_MS = 120_000;
  // An edit that didn't save can't be announced as done.
  let editFailed = false;
  let editSaved = false;
  const turnState = { approved: false };
  try {
    for (let step = 0; step < 7; step++) {
      if (step > 0 && Date.now() - started > TURN_DEADLINE_MS) {
        console.warn("[ai:brain] turn deadline reached", business.id, step);
        break;
      }
      const st = stageOf(business.plan);
      const system = st.system;
      // A question or "no entendí" is answered, never turned into an approval.
      const tools = askedSomething ? st.tools.filter((t) => t.name !== "approve_blocks") : st.tools;
      // The proposal is where the money is decided: high reasoning. Talking
      // with the person (interview, ideas) needs speed: medium.
      const deep = business.plan.stage === "proposal" || business.plan.stage === "approved";
      const res = await client.messages.create(
        {
          model: BRAIN_MODEL,
          // Muse Spark always reasons and the reasoning counts here.
          max_tokens: deep ? 14000 : 9000,
          output_config: { effort: deep ? "high" : "medium" },
          system: `${system}\n\nReply in ${es ? "Spanish (neutral, 'tú')" : "English"}.`,
          ...(tools.length ? { tools } : {}),
          messages,
        },
        // One quick retry at most: never minutes of "Pensando…".
        { timeout: 60_000, maxRetries: 1 }
      );
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
          const kept = res.content.filter((c) => c.type === "text");
          if (kept.length) messages.push({ role: "assistant", content: kept });
          messages.push({
            role: "user",
            content: es
              ? "(Sistema: no respondiste nada. Si la persona te dio datos, guárdalos. Después respóndele en una o dos frases y sigue: la siguiente pregunta que de verdad cambie la estrategia, o start_research si ya puedes investigar.)"
              : "(System: you didn't reply. If the person gave you data, save it. Then reply in one or two sentences and go on: the next question that really changes the strategy, or start_research if you can research now.)",
          });
          continue;
        }
        // A question already asked and answered is never asked again: the model
        // gets one more try with what the person answered back then.
        const rep = !startPipeline && !askedSomething && reply && business.plan.stage !== "proposal" && business.plan.stage !== "approved" ? repeatOf(reply) : null;
        if (rep && !retriedRepeat && Date.now() - started < 70_000) {
          retriedRepeat = true;
          console.warn("[ai:brain] repeated question, retrying", business.id, rep.q);
          const kept = res.content.filter((c) => c.type === "text");
          if (kept.length) messages.push({ role: "assistant", content: kept });
          messages.push({
            role: "user",
            content: `(${es ? "Sistema" : "System"}: ${es ? `ya preguntaste esto antes: «${rep.before.q}» y la persona respondió: «${rep.before.a.slice(0, 400)}». No lo vuelvas a preguntar, ni con otras palabras. Usa esa respuesta (guárdala si sirve) y escribe de nuevo tu mensaje completo: sigue con algo que de verdad cambie la estrategia, o llama a start_research si ya puedes investigar.` : `you already asked this: "${rep.before.q}" and the person answered: "${rep.before.a.slice(0, 400)}". Don't ask it again, not even in other words. Use that answer (save it if useful) and write your whole message again: go on with something that really changes the strategy, or call start_research if you can research now.`})`,
          });
          reply = "";
          continue;
        }
        if (rep && retriedRepeat) reply = reply.replace(rep.q, "").replace(/\s{2,}/g, " ").trim();
        break;
      }
      const results: ToolResultBlockParam[] = [];
      for (const u of uses) {
        let out: string;
        try {
          const r = await runTool(u.name, (u.input ?? {}) as Record<string, unknown>, business, opts.lang, ownerSaid, opts.message, lastAssistant, turnState);
          out = r.out;
          if (r.startPipeline) startPipeline = true;
          if (u.name === "update_proposal") {
            if (out.startsWith("error")) editFailed = true;
            else editSaved = true;
          }
        } catch (err) {
          console.error("[ai:brain] tool failed", u.name, err);
          out = "error: could not save";
        }
        business = (await getBusinessById(business.id))!;
        results.push({ type: "tool_result", tool_use_id: u.id, content: out });
      }
      // Replay only text and tool calls (Meta keeps its own reasoning).
      messages.push({ role: "assistant", content: res.content.filter((c) => c.type === "text" || c.type === "tool_use") });
      messages.push({ role: "user", content: [...results, { type: "text", text: `Updated state (JSON):\n${JSON.stringify(state(business, ownerReplies, saidByBrain))}` }] });
    }
  } catch (err) {
    logAiError("brain", err);
    debug = String((err as Error)?.message || err).slice(0, 400);
    reply = aiErrorReply(err, opts.lang === "en" ? "en" : "es");
  }
  // The model kept asking past the cap: the code starts the research itself.
  if (!startPipeline && interviewGate(business.plan, ownerReplies).forceResearch) {
    try {
      const r = await runTool("start_research", {}, business, opts.lang, ownerSaid, opts.message, lastAssistant, { ...turnState, force: true });
      if (r.out.startsWith("research started")) {
        startPipeline = true;
        business = (await getBusinessById(business.id))!;
        // What the reply answered stays (a question of theirs is never left
        // unanswered); its own questions go, and it says the research started.
        const kept = reply.split(/(?<=[.!?])\s+/).filter((x) => x.trim() && !/[?¿]/.test(x)).join(" ").trim();
        reply = `${kept ? `${kept} ` : ""}${es ? "Con esto ya tengo lo que necesito: ahora investigo tu zona y en unos minutos te muestro aquí lo que encontré." : "That's all I need: I'm researching your area now and I'll show you what I found here in a few minutes."}`;
      }
    } catch (err) {
      console.error("[ai:brain] could not start the research past the cap", business.id, err);
    }
  }
  // A question whose answer is already saved ("¿En qué ciudad?" after "en
  // Madrid"), or a permit question asked before, is taken out in code; if no
  // question is left and something essential is missing, the code asks it.
  if (!startPipeline && reply && brainDecides(business.plan)) {
    const d = withoutAnsweredQuestions(reply, business.plan, [...mem, { role: "user", content: opts.message }], es ? "es" : "en");
    if (d.dropped.length) {
      console.warn("[ai:brain] question already answered, taken out", business.id, d.dropped);
      reply = d.reply;
    }
  }
  if (!reply && startPipeline) {
    reply = es ? "¡Listo! Ya tengo lo que necesito. Ahora voy a investigar tu zona; en unos minutos te muestro aquí lo que encontré." : "Done! I have what I need. I'll research your area now; I'll show you what I found here in a few minutes.";
  }
  // The chat is locked while the research runs: a question there can't be
  // answered, so it's taken out of the message.
  if (startPipeline && /[?¿]/.test(reply)) {
    const kept = reply.split(/(?<=[.!?])\s+/).filter((x) => !/[?¿]/.test(x)).join(" ").trim();
    reply =
      kept ||
      (es ? "¡Listo! Ya tengo lo que necesito. Ahora voy a investigar tu zona; en unos minutos te muestro aquí lo que encontré." : "Done! I have what I need. I'll research your area now; I'll show you what I found here in a few minutes.");
  }
  // Checked in code on every reply: no repeat claims, one question, no
  // approval script after a question, and no sentence with internal words.
  reply = noRepeatClaims(reply);
  reply = oneQuestion(reply);
  if (askedSomething) reply = dropApprovalScript(reply) || reply;
  if (hasJargon(reply)) reply = reply.split(/(?<=[.!?])\s+/).filter((x) => !hasJargon(x)).join(" ").trim();
  if (editFailed && !editSaved && CLAIMS_EDIT.test(reply)) {
    reply = reply.split(/(?<=[.!?])\s+/).filter((x) => !CLAIMS_EDIT.test(x)).join(" ").trim();
    if (!reply) reply = es ? "Todavía no lo cambié. ¿Me dices exactamente cómo lo quieres y lo dejo así?" : "I haven't changed it yet. Tell me exactly how you want it and I'll set it.";
  }
  // In the proposal: no amount that isn't a package, the research or the owner's.
  if (business.plan.stage === "proposal" || business.plan.stage === "approved") reply = unknownAmountSentences(reply, business.plan, ownerSaid) || reply;
  // While it gets to know them: the only prices it may quote are the ones it
  // found on the web (with their source) or the person's own.
  if (business.plan.stage === "interview" && business.plan.mode !== "agent") reply = interviewAmountSentences(reply, business.plan, ownerSaid) || reply;
  // No discount the owner never asked for, not even as a suggestion.
  if (!business.plan.profile.offerWanted && !ASKS_OFFER.test(ownerSaid) && mentionsDiscount(reply))
    reply = reply.split(/(?<=[.!?])\s+/).filter((x) => !mentionsDiscount(x)).join(" ").trim();
  // Never show the owner our internal notes (they sometimes get echoed): the
  // notes are cut out, and if the cut leaves no question the next one is added.
  {
    const clean = scrubInternal(reply);
    if (clean.leaked) {
      console.warn("[ai:brain] internal note cut from a reply", business.id);
      reply = clean.reply;
    }
  }
  // What the owner never wants is never suggested, not even as an example.
  reply = withoutAvoidedSuggestions(reply, business.plan.profile.notWant) || reply;
  reply = neutralGender(reply);
  reply = reply
    .replace(/^\s*\((Tarjeta mostrada|Card shown)[^)\n]*\)\s*$/gim, "")
    .replace(/\$\s*\$(?=\s?\d)/g, "$")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { reply: reply || (es ? "Listo, guardé lo que me dijiste. Escríbeme «sigue» y continúo." : "Done, I saved what you told me. Write \"go on\" and I'll continue."), business, startPipeline, debug };
}

export function planGreeting(lang: Lang, b: BusinessRow): string {
  const es = lang === "es";
  const p = b.plan;
  if (p.mode === "agent") {
    return es
      ? "¡Hola! Soy el Cerebro de Sevrii. Vamos a crear tu agente: un producto digital que resuelve un problema por chat, solo, las 24 horas, y cobra por usarlo. No tiene que ser de tu oficio: yo investigo qué problemas paga la gente por resolver y te propongo 3 ideas. Para empezar: ¿hay algún tema o tipo de problema que te interese, o quieres que te proponga ideas abiertas?"
      : "Hi! I'm Sevrii's Brain. Let's create your agent: a digital product that solves a problem by chat, by itself, 24/7, and charges for it. It doesn't have to be about your trade: I'll research what problems people pay to solve and propose 3 ideas. To start: is there a topic or kind of problem you're interested in, or should I propose open ideas?";
  }
  // A project that already answered the old interview cards: the greeting
  // never asks again what they answered there.
  const card = (id: string) => (p.cards[id] && !p.cards[id].u ? p.cards[id].v.trim() : "");
  if (p.stage === "interview" && Object.keys(p.cards).length) {
    if (p.mode === "existing" && (p.profile.mainService || card("service"))) {
      const service = p.profile.mainService || card("service");
      const where = p.profile.serviceMode === "remote" ? (es ? "en línea" : "online") : p.profile.city || p.cards.service?.p?.trim() || "";
      return es
        ? `¡Hola! Soy el Cerebro de Sevrii. Ya tengo lo que me contaste: ${service}${where ? ` (${where})` : ""}. Si quieres, cuéntame qué te frena hoy para tener más clientes; si no, escribe «investiga» y empiezo con tu plan.`
        : `Hi! I'm Sevrii's Brain. I already have what you told me: ${service}${where ? ` (${where})` : ""}. If you like, tell me what holds you back from getting more clients today; if not, write "research" and I'll start your plan.`;
    }
    if (p.mode === "new" && (p.profile.workHistory || p.profile.likes || card("talent") || card("experience") || card("likes"))) {
      if (p.profile.goal)
        return es
          ? "¡Hola! Soy el Cerebro de Sevrii. Ya tengo lo que me contaste en tus respuestas. Si quieres agregar algo, cuéntame; si no, escribe «dame ideas» y busco los servicios que más te convienen."
          : "Hi! I'm Sevrii's Brain. I already have what you told me in your answers. If you want to add something, tell me; if not, write \"give me ideas\" and I'll look for the services that suit you best.";
      return es
        ? "¡Hola! Soy el Cerebro de Sevrii. Ya tengo lo que me contaste en tus respuestas. Para proponerte los mejores servicios me falta una cosa: ¿buscas un ingreso extra o vivir de esto?"
        : "Hi! I'm Sevrii's Brain. I already have what you told me in your answers. To suggest the best services I need one more thing: are you after extra income, or to live from this?";
    }
  }
  if (p.mode === "new") {
    return es
      ? "¡Hola! Soy el Cerebro de Sevrii. Vamos a encontrar el servicio que más te conviene empezar, con lo que ya sabes o con algo nuevo. Cuéntame un poco de ti: ¿qué sabes hacer o en qué has trabajado?"
      : "Hi! I'm Sevrii's Brain. Let's find the service that suits you best to start, with what you already know or something new. Tell me a bit about yourself: what can you do, or what jobs have you had?";
  }
  return es
    ? "¡Hola! Soy el Cerebro de Sevrii. Vamos a conseguirte más clientes con el servicio que ya ofreces. Cuéntame de tu negocio: ¿qué ofreces y dónde?"
    : "Hi! I'm Sevrii's Brain. Let's get you more clients with the service you already offer. Tell me about your business: what do you offer, and where?";
}
