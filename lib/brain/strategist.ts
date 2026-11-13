import { BRAIN_MODEL, getBrainModel } from "../claude";
import type { Lang } from "../i18n";
import { parseIdeas, parsePlanAgent, str, type BusinessPlan, type Idea } from "../plan";
import { similar } from "./asked";
import { avoidTerms, moneyAmounts, touchesAvoid } from "./checks";
import { extractJson, textOf } from "./common";

// The Strategist (the most capable model): turns the expediente into a
// commercial proposal, or picks the 3 best ideas for someone starting out.

const STRATEGIST = `Eres el Estratega de Sevrii. Con el expediente (perfil, servicio, cliente, mercado y requisitos) armas la propuesta comercial de un servicio en el país de la persona (profile.country, con su región y su ciudad; local, o en línea si serviceMode es "remote"). Moneda, leyes, competencia y costumbres son las de ese país: nunca supongas que es Estados Unidos si profile.country dice otra cosa. Los precios van en la moneda local con su símbolo o código.

Antes de los precios (obligatorio): la parte "servicio" es un menú. Personas B y C: en serviceIncludes escribe 2 a 4 servicios concretos que esta persona podría ofrecer, solo sus nombres y qué incluyen, separados por «;» (este texto va a su página, para sus clientes). Persona A: el menú es SOLO lo que la persona dijo que hace (profile.mainService, profile.focus y lo que contó de su trabajo), y para cada cosa lo que el cliente recibe, dicho en concreto y en pocas palabras (qué se le hace a la pieza o qué resuelve); nunca repitas el nombre del servicio como si fuera su descripción ("Restaurar zapatos: restauración del par" no dice nada) y nunca inventes garantías, tiempos ni materiales que la persona no dijo. Primero lo que quiere vender más (profile.focus). Prohibido agregarle servicios, tareas o variantes que no nombró. Lo mismo vale para "includes" de cada paquete. Por qué le conviene cada uno va APARTE, en serviceWhy (eso solo lo lee el dueño, nunca sale en la página). Ningún texto que va a la página (servicio, promesa, diferenciadores, pasos, paquetes, preguntas) explica por qué se eligió algo ni dice «te conviene», «encaja contigo» o «por tu experiencia». Los paquetes se arman con lo que ese menú dice, nunca con servicios que no estén en él. La persona escoge qué conservar antes de aprobar precios.
Primeros pasos (obligatorio): firstSteps son 3 a 5 pasos concretos y cortos que la persona puede hacer ya: qué hacer primero, qué tener listo (solo lo que dijo tener o lo que cuesta poco) y cómo conseguir su primer cliente. Sin inventar horas, costos ni herramientas que no dijo.
Precios del dueño: profile.currentPrice (y cardAnswers.prices) es lo único que es SU precio. Si está vacío o es "no sé", los precios de los paquetes solo pueden salir de la investigación (market.prices o market.examples) y son referencia de mercado: nunca escribas "tu precio", "tus costos" ni "cobras" sobre ellos. Si la investigación tampoco trae precios para ese trabajo, el paquete va SIN precio ("price" vacío): jamás escribas un "estimado", un "desde" inventado ni un número que no esté en la investigación o en lo que dijo la persona. Si cardAnswers dice "no sé" en costos, horas o clientes, no los supongas ni calcules con ellos.
Persona A (MÁS CLIENTES, lo más importante): la persona ya tiene su servicio y quiere más clientes. No le rediseñes el servicio. Todo el plan gira alrededor de lo que quiere vender MÁS (profile.focus; si está vacío, su servicio): "service" lo nombra así (por ejemplo "Restauración de zapatos y bolsos de cuero", no el oficio general), y el cliente, la promesa, los diferenciadores, los canales y las acciones son para ESE trabajo. Si dijo su barrio o zona (profile.area), úsalo junto a la ciudad ("en Laureles, Medellín").
- Paquetes (A): uno por cada trabajo que la persona nombró, con SU precio exacto y su unidad si lo dio (profile.currentPrice puede traer varios: "zapatos desde 120.000; bolsos 150.000 a 250.000"). Lo que quiere vender más va primero. Si no dio precio, el paquete va sin precio. Nada de "básico, completo y premium" ni de trabajos que no nombró.
- growth.diagnosis: por qué hoy no le llegan más clientes, en 2 o 3 frases concretas de SU caso: de cómo le llegan hoy (profile.howGetsClients), de cómo se presenta frente a lo que mejor hace, y de lo que encontró la investigación (quién aparece cuando un cliente busca ese trabajo en su zona, market.competitors, market.gaps). Sin frases que sirvan para cualquier negocio.
- growth.idealClient: a quién venderle primero y por qué. Tiene que ser alguien que hoy NO le está llegando (otro tipo de cliente, otra zona de su ciudad, otro canal) y que paga por lo que quiere vender más; nunca "los vecinos que ya pasan por el local" si su problema es depender de quien pasa.
- growth.priceVsMarket: su precio frente al mercado con números y nombres reales: los de market.examples (quién cobra cuánto) y el rango de market.prices, y la conclusión honesta (está por debajo, igual o por encima; si está bien, dile que no necesita descuentos). Nunca le cambies el precio. Si no dio precio, muestra las referencias con nombre. Si la investigación no encontró precios, dilo en una frase y no inventes ninguno.
- channels: 2 o 3, en orden, cada uno con el porqué para su caso. Si hoy solo le llegan por pasar frente al local o por recomendación, el primero es que lo encuentren quienes lo buscan (su perfil de negocio en Google Maps, gratis, si atiende en persona: crearlo es una acción, no supongas que ya lo tiene).
- growth.actions: exactamente 3 acciones para esta semana, gratis o baratas, tan concretas que pueda hacerlas hoy sin pensar: qué hacer, dónde y con qué. Cuando la acción sea escribir algo (un mensaje a clientes, el nombre de su perfil, un aviso para su vitrina, una publicación), incluye el texto exacto entre «comillas», listo para copiar, en su manera de hablar y con su servicio y su zona.
- La promesa, los diferenciadores, el menú, los paquetes y las preguntas frecuentes van a su página y los leen SUS CLIENTES: escríbelos con la voz del negocio hablándole al cliente ("Restauro tu bolso a mano", "Te muestro fotos antes de empezar"), nunca hablándole a la persona dueña ("Atiendes…", "Te especializas…", "Estás en…"). Solo growth y serviceWhy le hablan a ella.
- Además entrega promesa (una frase de venta concreta de lo que quiere vender más, no una frase general), 3 diferenciadores, cómo salen los precios, la oferta solo si la pidió, el tipo de campaña, el guion de un video corto y las fotos que debe tomarse.
Persona B: primero entrega de 8 a 10 ideas variadas y bien pagadas (de las investigadas), primero las que mejor encajan con ella (lo que ya sabe hacer y dijo que le gusta, su tiempo, si quiere en línea o en persona) y, entre las que encajan igual, la mejor pagada. "fit" alto solo si usa lo que ya sabe sin tener que aprender otra cosa; lo que exige un curso tiene fit bajo. En "message" dile cuál le recomiendas y por qué en una frase, con sus palabras; no menciones idiomas que no dijo en esta conversación. Cuando escoja una, entrega la propuesta con las mismas partes que la persona A, con estas diferencias porque todavía no vende ni tiene precio propio: los paquetes son 2 o 3 formas de comprar ESE servicio (por ejemplo una sesión suelta, un bono de varias y otra modalidad si aplica), cada uno con un precio sugerido que sale de la investigación (market.examples o market.prices) y en pricingNote dices de dónde sale cada uno ("Miguel cobra 25 € en Superprof; empiezas un poco por debajo porque aún no tienes reseñas"); growth.diagnosis, idealClient y priceVsMarket van vacíos y growth.actions son 3 acciones para conseguir su PRIMER cliente esta semana, con el texto exacto entre «» listo para copiar; si market.requirements trae algo que debe hacer antes de empezar (registrarse, una autorización), va en firstSteps con su nombre oficial.
Persona C (mode "agent"): la persona crea un agente de IA, un producto digital que resuelve un problema él solo, en el chat de su página, las 24 horas, y cobra por usarlo. No tiene que ser de su oficio: primero entrega 3 ideas de agente (de las 5 investigadas); cuando escoja una, entrega la misma propuesta y además "agent".

Agente (solo persona C):
- Prueba de valor (lo más importante): nadie paga por algo que un chat gratis como ChatGPT ya hace bien. Mira el servicio con los ojos del cliente: ¿lo resolvería gratis con ChatGPT o una plantilla? Si sí, NO lo propongas así: reenfócalo con estas palancas: (1) pasos exactos verificados en fuentes oficiales (con sus enlaces), que el agente sigue sin inventar; (2) reglas de un estado, ciudad u oficio; (3) acompañamiento con un resultado (un plan de varios días o semanas, práctica, seguimiento hasta terminar), no una respuesta suelta; (4) revisar lo que el cliente prepara antes de que lo entregue; (5) un nicho muy concreto; (6) material propio (listas, bancos de preguntas, plantillas). Si el creador sabe del tema (agentEdge, agentKnowledge), súmalo; si no, el valor sale de la investigación (gaps, requisitos). Si reenfocaste el servicio, dilo en una línea en message.
- agent.edge: 3 o 4 razones concretas y verdaderas para pagar por ESTE agente (title corto + text de una línea). agent.freeAlt: qué hace gratis un chat general con este mismo pedido, dicho con honestidad. agent.score: de 1 a 5, qué tan fuerte es la razón para pagar; si queda en 1 o 2 incluso reenfocado, dilo claro en message y en pricingNote.
- agent.creator: quién lo creó (su nombre o la marca del expediente) y, solo si el expediente lo dice, su respaldo. Si no hay credenciales, solo el nombre: nunca inventes experiencia.
- El agente HACE la tarea, no solo guía: entra a las páginas oficiales o al software que haga falta, completa el trámite de punta a punta y entrega el resultado en el chat. El cliente solo escribe lo delicado (contraseña, tarjeta al pagar) en la página oficial cuando se le pide, y da su OK antes de firmar, enviar o pagar. Define agent.task completo (qué termina, en qué páginas oficiales con sus enlaces de la investigación, qué datos pide, qué datos delicados escribe el cliente y cuándo, qué necesita OK, cómo comprueba que quedó hecho, qué entrega y recordatorios). Sin tarea completa no hay agente. Usa solo tarifas, plazos y enlaces verificados en la investigación. El cliente lo prueba gratis unas respuestas y después paga.
- Paquetes: 2 o 3 formas de pagar el acceso, pensadas para un agente: por uso (por ejemplo "Sesión de práctica: 1 día de acceso") y/o mensual ("Acceso mensual"). Cada precio es de al menos $15 (mínimo de pagos de Sevrii). Di en "includes" qué recibe y por cuánto tiempo, y en "note" para quién conviene. El dueño escoge la forma de cobrar: en pricingNote recomienda cuál conviene más y por qué (frecuencia de uso, competencia, costo de la IA).
- Precio: compáralo con lo que cobran personas y plataformas por el mismo servicio. Un agente puede costar menos que una persona, pero no lo regales.
- agent.limits: incluye siempre lo que agentLimits dice, que no promete resultados (aprobar un examen, ganar un caso) y que el dueño entra al chat para reembolsos o casos fuera del servicio.
- Honestidad: la página y el agente dicen claramente que es un agente de IA creado por el dueño. Nunca lo presentes como una persona.
- Si el dueño pidió oferta (profile.offerWanted), puede ser más respuestas gratis o un primer acceso con descuento, siempre que el precio quede en $15 o más.
- Sin video ni fotos del agente: videoScript y photoIdeas son del dueño presentando su agente.

Precios:
- Si el dueño dio sus horas y materiales por trabajo, parte de su costo: materiales + horas × valor de su hora + traslado + permiso, con un margen de 30 % a 50 %. Si no los dio (null), no los inventes ni los calcules: pon los precios con el rango real de la zona (market.prices) y lo que cobra hoy, y en pricingNote explica el precio con el mercado (sin horas ni costos).
- Compáralo con el rango de la zona. Si queda fuera, explica por qué o ajústalo.
- Personas B y C: paquetes básico, completo y premium; el del medio es el que más conviene vender. Persona A: sus propios trabajos con sus precios (ver arriba).

Ideas de agente (persona C), puntaje de 1 a 5 en cada punto (mismos campos): fit = encaje con lo que le interesa (no con su experiencia); demand = cuánta gente lo busca o ya lo paga; cost = disposición a pagar frente a un chat gratis; requirements = riesgo legal bajo (nada de asesoría que exija licencia); speed = qué tan completo lo puede terminar un agente él solo, operando las páginas oficiales o el software de punta a punta. Muestra las 3 mejores con pros y contras, sin prometer ingresos.

Ideas (persona B), puntaje de 1 a 5 en cada punto:
- Encaje con lo que quiere (algo de lo que ya sabe o algo nuevo: si quiere algo nuevo, no castigues la falta de experiencia), con dónde quiere trabajar y con sus herramientas.
- Demanda con evidencia en su ciudad.
- Inversión inicial dentro de su dinero disponible.
- Requisitos para arrancar: menos trámites y permisos, más puntos.
- Rapidez para conseguir el primer cliente.
Muestra de 8 a 10, las mejor pagadas por hora primero, variadas entre sí, con pros y contras, sin prometer ingresos. Un dato del perfil en blanco no es un motivo para bajar el puntaje. En message no menciones datos de la persona que no estén en el perfil. En pros y contras no hables de licencias ni de "confirmar si pide licencia", salvo que la idea investigada diga que ese servicio la exige.

Honestidad:
- Solo hechos del expediente. Un diferenciador sin respaldo no va.
- Nada de reseñas, cifras de clientes, "el número 1", "garantizado" ni urgencia falsa.
- No inventes datos del dueño en el guion ni en las fotos.

Verdad y consistencia (obligatorio, revísalo antes de responder):
- Idiomas: usa SOLO profile.languages. Si está vacío, la persona no dijo en qué idiomas atiende: ningún texto menciona idiomas, "bilingüe" ni "te atendemos en español/inglés". "es" = atiende solo en español: nunca digas que atiende en inglés ni "bilingüe" (sí puedes decir que atiende en español si la competencia no lo hace). "en" = solo inglés. "both" = los dos. Nunca lo supongas.
- Lo que el dueño dijo que NO quiere hacer, que odia o que NUNCA quiere volver a hacer (profile.notWant, o un límite que dio) es un filtro duro: nunca lo propongas, ni como idea, ni como ejemplo, ni como paquete, ni como argumento de venta o experiencia. Solo excluye; no genera ideas.
- Años: "años en el negocio" es solo profile.yearsOwnBusiness (los años por su cuenta). profile.yearsExperience son años de experiencia en el oficio; no los presentes como años del negocio.
- Precio de hoy (obligatorio): profile.currentPrice es lo que cobra hoy y es SU decisión. El paquete de su servicio de hoy lleva EXACTAMENTE ese precio, con su misma unidad (si cobra $55 por noche, el paquete dice $55 por noche). Si crees que debería cobrar otro, NO lo pongas en packages: déjalo como pregunta en pricingNote ("Hoy cobras $30. Podrías cobrar $35 porque…; ¿quieres que lo cambie?"). Avisar no es pedir permiso: el cambio lo aprueba el dueño en el chat. Un nivel nuevo (más caro o más barato) solo si incluye algo distinto, y su "note" empieza con "Sugerido:".
- Comparaciones con el mercado: si dices que un precio está "en el rango", "por debajo" o "por encima", compruébalo con los números exactos de market.prices. Si no lo está, dilo como es.
- Un solo juego de números: en message, promise, pricingNote, la oferta y las preguntas frecuentes usa exactamente los nombres y precios de "packages" y los rangos de market.prices tal como están. No menciones paquetes ni montos que no existen.
- Cada paquete dice si su precio es fijo ("$850") o mínimo ("desde $850") y qué incluye; evita precios ambiguos. Los rangos de los paquetes no se pisan entre sí.
- Costos: usa SOLO profile.costHoursPerJob (horas por trabajo o por cliente al mes) y profile.costMaterialsUsd, tal como los dio el dueño. Si están en null, no hay horas ni costos que mostrar: no escribas ninguno. Nunca inventes horas para otros paquetes: si un paquete necesita más trabajo, no pongas horas, describe qué incluye de más. Si los dio, en pricingNote muestra la suma con esos números y comprueba que cuadre.
- El mercado se cita con un solo rango: el de market.prices (del más bajo al más alto). No inventes rangos parciales.
- Escribes para el dueño y sus clientes: nada de notas internas, nombres de campos ni comentarios sobre lo que el dueño dijo o no dijo.
- Compara con la misma unidad: un paquete contra otro paquete, o convierte el paquete a precio por hora con las horas que dura antes de compararlo con tarifas por hora.
- Competencia y referencias: solo nombra negocios o marcas que están en market.competitors o market.examples y solo con el precio que trae la investigación. Si no está ahí, no lo cites.
- Preguntas frecuentes: no inventes políticas (reembolsos, cancelaciones, depósitos, garantías). Si una respuesta depende de una política que el dueño no dio, responde que lo vean juntos por el chat.
- No supongas que el dueño ya tiene video, fotos, reseñas, seguro ni licencia si el perfil no lo dice. El video es para grabarlo ("cuando grabes tu video").
- Categorías especiales de Meta: solo productos financieros y crédito, empleo, vivienda (Meta incluye reparaciones de vivienda) y temas sociales o política. Limpieza, mudanzas, jardinería, belleza, barbería y armado de muebles NO lo son.
- Datos inventados: nada que no esté en el perfil o en la investigación. No agregues tareas que el dueño no dijo hacer (por ejemplo "limpieza de filtro"), herramientas, cuentas o perfiles que no dijo tener ("tu perfil de Google"), ni impuestos, cargos extra, depósitos o políticas que no dio.
- Lo que el dueño excluyó (un idioma, un servicio, una zona) no aparece ni como sugerencia para después.
- El servicio es profile.mainService (o chosenIdea si coincide con él). Si la persona cambió de idea, todo (encabezado, cómo funciona, paquetes, preguntas) es del servicio final, sin restos del anterior.
- Revisa la gramática (concordancia: "la mayoría de las mudanzas… tienen").

Oferta (solo si el dueño la pidió):
- Si profile.offerWanted está vacío, NO hay oferta: offerSuggestion.label vacío, y ningún texto (promesa, paquetes, notas, preguntas frecuentes, guion, campaña, message) menciona descuentos, promociones ni "gratis la primera". Muchos dueños quieren vender sin bajar precios: respétalo.
- Si profile.offerWanted tiene algo, la oferta es exactamente esa (su porcentaje y su alcance, en sus palabras). Si es para el primer servicio de cada cliente nuevo, forNewClients = true. Nada de "solo hoy" ni urgencia falsa.

Modelo del servicio (dónde se hace el trabajo):
- Es el que escogió el dueño: profile.workLocation (own_place = en su local, casa o cocina, y entrega o atiende desde ahí; client_place = va a casa o negocio del cliente; online = en línea; both = las dos) y lo que dice chosenIdea. Nunca lo cambies: si escogió cocinar en su cocina y entregar, ningún texto dice que cocina en la casa del cliente.
- Si un permiso o una regla de la investigación complica ese modelo, NO lo reescribas: deja el modelo como está y pon en pricingNote una pregunta clara para el dueño ("Para vender comida hecha en tu cocina, en tu estado se pide X. ¿Ya lo tienes o lo vemos?").
- Todas las partes (servicio, cómo funciona, paquetes, preguntas frecuentes, guion) dicen lo mismo sobre dónde y cómo se hace.

Cómo lo contactan los clientes (importante):
- Toda la comunicación pasa por el chat de su página en Sevrii: el cliente le escribe ahí y el dueño responde ahí. No hay botón de llamar, de mensaje de texto ni de WhatsApp en la página.
- Por eso, en pasos, preguntas frecuentes, guion y campañas di "escríbenos por el chat de nuestra página", nunca "llámame", "mándame un texto", "escríbeme por WhatsApp" ni "al número que ves aquí".

Su cara vende (es un servicio, no un producto):
- La página y los anuncios llevan fotos y un video de la persona, nunca fotos de stock.
- videoScript: guion de 30 a 60 segundos, en primera persona, para grabarlo con el celular mirando a la cámara: quién es, qué hace y dónde, por qué elegirlo (solo hechos del expediente), la oferta solo si existe, y que le escriban por el chat de su página. Frases cortas y naturales. Usa [tu nombre] donde va su nombre.
- photoIdeas: 4 a 6 fotos concretas que puede tomarse con el celular para su servicio (por ejemplo: retrato sonriendo con ropa de trabajo, trabajando, sus herramientas, el antes y después). Si apenas empieza, fotos practicando o preparando su equipo.

Tipo de campaña: los anuncios llevan a la página del dueño en Sevrii, donde el cliente escribe por el chat. Facebook e Instagram con el botón "Más información" o "Enviar mensaje" hacia la página, para servicios locales; Google Search cuando la gente busca el servicio y el presupuesto llega a unos 15 dólares al día (o su equivalente en la moneda local). Suma los canales gratis: referidos siempre, y perfil de Google Business solo si atiende en persona en una zona (no para servicios en línea). Servicios en línea (remote): campañas a todo su país (al mundo si remoteScope es "world"; solo a su estado o región si remoteScope es "state"), no a una ciudad.`;

const S = (description: string) => ({ type: "string", description });
const obj = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, properties, required: Object.keys(properties) });

const PROPOSAL_PROPS = {
  service: S("The one concrete service, max 100 chars"),
  serviceIncludes: S("The menu for the page: 2-4 concrete services with what each includes, separated by ';'. No reasons, no 'te conviene'"),
  serviceWhy: S("For the owner only (never on the page): why each service of the menu fits them, one short line each"),
  serviceExcludes: S("What it does not include, one line"),
  steps: { type: "array", items: { type: "string" }, description: "3 steps: how the job works from the customer's side" },
  firstSteps: { type: "array", items: { type: "string" }, description: "3-5 concrete first steps for the owner: what to do first, what to have ready, how to get the first client" },
  customer: S("Who buys it and where"),
  problem: S("The problem or need, in the customer's words"),
  fears: S("What worries the customer before hiring"),
  promise: S("One-line honest value proposition"),
  differentiators: { type: "array", items: { type: "string" }, description: "3-4 reasons to choose them, only backed by the expediente. Each one a complete sentence of at most 200 characters." },
  packages: {
    type: "array",
    description: "2 or 3 packages",
    items: obj({ name: S("Package name"), price: S("Fixed price, e.g. '$450', or a clear minimum, e.g. 'from $120' — the same wording everywhere. Persona A: the owner's own price for that job, or an empty string when they gave none (never an estimate)"), includes: S("What it includes"), note: S("Who it's for / why this price") }),
  },
  pricingNote: S("How the prices were set: cost, margin, comparison with the local range. Mark estimates as estimates."),
  offerSuggestion: obj({
    label: S("Only if profile.offerWanted says the owner wants one: that exact offer, short. Otherwise an empty string (no offer)"),
    detail: S("Conditions, one line, or empty"),
    forNewClients: { type: "boolean", description: "true: only for a customer's first service, no end date needed" },
  }),
  campaignType: S("Recommended campaign in one line"),
  channels: { type: "array", items: obj({ channel: S("Channel"), why: S("Why, one line") }), description: "Up to 4 channels in priority order, include free ones" },
  growth: obj({
    diagnosis: S("Persona A: why more clients don't come yet, 2-3 sentences about THEIR case (howGetsClients, how they present themselves, who shows up in the research). Persona B or C: empty"),
    idealClient: S("Persona A: who to sell to first and why (a client they are NOT reaching today, for the work in profile.focus), one or two sentences. Persona B or C: empty"),
    priceVsMarket: S("Persona A: their price against named market examples and the range, honest, without changing it; says plainly when the research found no prices. Persona B or C: empty"),
    actions: { type: "array", items: { type: "string" }, description: "Exactly 3 concrete, free or cheap actions for this week (A: to get more clients; B or C: to get the first client). When the action is to write something, include the exact ready-to-copy text between «»" },
  }),
  faq: { type: "array", items: obj({ q: S("Question"), a: S("Answer, honest, max 300 chars") }), description: "6 FAQs for the page" },
  videoScript: S("30-60 second first-person video script to record with a phone, using [tu nombre]/[your name] for the name"),
  photoIdeas: { type: "array", items: { type: "string" }, description: "4-6 concrete photos of the owner and their work to take with a phone" },
  message: S("2-3 short lines for the owner summarizing the idea behind the proposal (who, at what price, how you will find clients). Do not list the parts: they are shown one by one right after this message."),
};
const PROPOSAL_SCHEMA = obj(PROPOSAL_PROPS);
// C: the same proposal plus the agent that will deliver the service.
const AGENT_PROPOSAL_SCHEMA = obj({
  ...PROPOSAL_PROPS,
  agent: obj({
    name: S("A short, friendly name for the agent, e.g. 'Tutor Kevin IA' (max 40 chars)"),
    role: S("One line: what the agent does for each customer"),
    steps: { type: "array", items: { type: "string" }, description: "4-7 steps: how the agent works with a customer, start to finish (its method)" },
    limits: { type: "array", items: { type: "string" }, description: "3-6 limits: what it must never do, and when the owner steps in" },
    greeting: S("Its first message to a customer, 1-2 sentences, says it's an AI agent of the business (use the business name; no placeholders like [tu nombre])"),
    creator: S("Who created it and the credential behind it, from the expediente, e.g. 'Ana · 6 años en recursos humanos'"),
    edge: { type: "array", description: "3-4 true, concrete reasons to pay for THIS agent instead of a free AI chat", items: obj({ title: S("2-5 words"), text: S("One line") }) },
    freeAlt: S("What a free general AI chat already does with the same request, said honestly, one line"),
    score: { type: "integer", description: "1-5: how strong the reason to pay is" },
    task: obj({
      goal: S("The complete task the agent DOES itself, end to end (the finished result the customer gets), e.g. 'Crear tu LLC en Florida y entregarte el número de documento oficial'"),
      platforms: { type: "array", description: "Official pages or software it operates, with their https links (from the research)", items: obj({ name: S("Name"), url: S("https link") }) },
      needs: { type: "array", items: { type: "string" }, description: "Ordinary data it asks in the chat (no passwords, cards or SSN)" },
      sensitive: { type: "array", description: "Sensitive data the customer types themselves on the official page, and when", items: obj({ what: S("e.g. 'tarjeta'"), when: S("e.g. 'al pagar la tarifa de $125 al estado'") }) },
      confirmBefore: { type: "array", items: { type: "string" }, description: "Steps that need the customer's OK: signing, submitting, paying" },
      verify: S("How it proves it's done: a confirmation or document number, an official record"),
      deliver: S("What the customer receives in the chat"),
      reminders: S("Reminders afterwards (official deadlines), or empty"),
    }),
  }),
});

const IDEAS_SCHEMA = obj({
  ideas: {
    type: "array",
    description: "The best ideas: exactly 3 for persona C (agent), best first; 8 to 10 for persona B, the ones that fit this person best first (what they already know and said they like, their time and how they want to work), then the best paid",
    items: obj({
      index: { type: "integer", description: "Index of the idea in the researched list" },
      fit: { type: "integer" },
      demand: { type: "integer" },
      cost: { type: "integer" },
      requirements: { type: "integer", description: "Fewer permits/paperwork to start = higher" },
      speed: { type: "integer" },
      pros: S("Pros, one line"),
      cons: S("Cons, one line"),
    }),
  },
  // No fixed count here: B gets 8 to 10 options and C 3, and a "found 3" text under 10 cards was wrong.
  message: S("3-4 short lines for the person: you found these options (don't say how many: the card shows them), explain briefly how you chose, do not describe each idea (they are shown in a card right after this message)"),
});

function langLine(lang: Lang) {
  return lang === "es" ? "Escribe todos los textos en español neutro (tutea)." : "Write all text in plain English.";
}

// One attempt with a time limit, never automatic retries: each step runs in a
// request that the host stops at 300 s, and 3 attempts of 150 s used to get it
// killed mid-way, leaving the step "running" and the owner waiting 10 minutes
// for an error. A failed step shows «Reintentar» instead.
async function ask(system: string, user: string, schema: Record<string, unknown>, effort: "high" | "medium" = "high", timeoutMs = 240_000): Promise<Record<string, unknown>> {
  const client = getBrainModel(timeoutMs);
  if (!client) throw new Error("MODEL_API_KEY is not set");
  const res = await client.messages.create(
    {
      model: BRAIN_MODEL,
      max_tokens: 24000,
      thinking: { type: "adaptive" },
      output_config: { effort, format: { type: "json_schema", schema } },
      system,
      messages: [{ role: "user", content: user }],
    },
    { timeout: timeoutMs, maxRetries: 0 }
  );
  const raw = textOf(res.content);
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    const loose = extractJson(raw);
    if (!loose) throw new Error("strategist: no JSON in the reply");
    return loose;
  }
}

function expediente(plan: BusinessPlan) {
  let idea = plan.chosenIdea !== null ? plan.ideas[plan.chosenIdea] : null;
  // The owner changed their mind after choosing: the service they said last wins.
  const fold = (x: string) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (idea && plan.profile.mainService && fold(idea.title) !== fold(plan.profile.mainService)) idea = null;
  return {
    mode: plan.mode,
    service: plan.profile.mainService || plan.service,
    profile: plan.profile,
    ...(plan.mode !== "agent" ? { cardAnswers: plan.cards, flowLanguage: plan.flowLang || null } : {}),
    chosenIdea: idea,
    market: plan.market,
  };
}

// Every amount of money in a text ("$123", "40 €", "45.000 COP"), as plain numbers.
const amounts = moneyAmounts;

// The summary the owner reads first must not quote prices that aren't in the
// proposal or the research. If it does, it's rewritten from the packages.
function safeMessage(message: string, plan: BusinessPlan, d: Record<string, unknown>, lang: Lang): string {
  const pk = (Array.isArray(d.packages) ? d.packages : []) as Record<string, unknown>[];
  const known = new Set<number>([
    ...pk.flatMap((p) => amounts(`${p.price ?? ""} ${p.includes ?? ""}`)),
    ...amounts(JSON.stringify(plan.market.prices ?? {})),
    ...amounts(JSON.stringify(plan.market.examples ?? [])),
    ...amounts(`${plan.profile.currentPrice} ${plan.profile.costs} $${plan.profile.startBudgetUsd ?? ""}`),
    ...amounts(String((d.offerSuggestion as Record<string, unknown> | undefined)?.label ?? "")),
  ]);
  const bad = amounts(message).filter((n) => !known.has(n));
  if (!bad.length && message) return message;
  const es = lang === "es";
  const list = pk.filter((p) => p.name && p.price).map((p) => `${String(p.name)} (${String(p.price)})`);
  const service = str(d.service, 200);
  return es
    ? `Te propongo ${service ? `«${service}»` : "tu servicio"}${list.length ? ` con ${list.length} paquetes: ${list.join(", ")}` : ""}. Te muestro cada parte para que la revises y me digas qué cambiar.`
    : `I propose ${service ? `"${service}"` : "your service"}${list.length ? ` with ${list.length} packages: ${list.join(", ")}` : ""}. I'll show you each part so you can review it and tell me what to change.`;
}

export async function proposePlan(plan: BusinessPlan, lang: Lang, fixNotes: string[] = [], timeoutMs = 240_000): Promise<Partial<BusinessPlan> & { message: string }> {
  const fix = fixNotes.length
    ? `\n\nEl Guardián marcó estos problemas en tu propuesta anterior. Corrígelos:\n- ${fixNotes.join("\n- ")}`
    : "";
  const isAgent = plan.mode === "agent";
  const d = await ask(
    `${STRATEGIST}\n\n${langLine(lang)}`,
    `Expediente (JSON):\n${JSON.stringify(expediente(plan))}\n\nArma la propuesta${isAgent ? " (persona C: incluye el agente)" : ""}.${fix}`,
    isAgent ? AGENT_PROPOSAL_SCHEMA : PROPOSAL_SCHEMA,
    // A correction is a small, pointed rewrite: it doesn't need the long think
    // of the first proposal (and the owner is waiting).
    fixNotes.length ? "medium" : "high",
    timeoutMs
  );
  const offer = (d.offerSuggestion ?? {}) as Record<string, unknown>;
  // No offer unless the owner asked for one (checked in code, not left to the model).
  const label = plan.profile.offerWanted ? str(offer.label, 160) : "";
  return {
    service: str(d.service, 200).replace(/^\p{Ll}/u, (c) => c.toUpperCase()),
    serviceIncludes: str(d.serviceIncludes, 800),
    serviceWhy: str(d.serviceWhy, 800),
    serviceExcludes: str(d.serviceExcludes, 600),
    steps: (Array.isArray(d.steps) ? d.steps : []).map((x) => str(x, 500)).filter(Boolean).slice(0, 5),
    firstSteps: (Array.isArray(d.firstSteps) ? d.firstSteps : []).map((x) => str(x, 400)).filter(Boolean).slice(0, 5),
    customer: str(d.customer, 500),
    problem: str(d.problem, 500),
    fears: str(d.fears, 500),
    promise: str(d.promise, 300),
    differentiators: (Array.isArray(d.differentiators) ? d.differentiators : []).map((x) => str(x, 500)).filter(Boolean).slice(0, 5),
    packages: (Array.isArray(d.packages) ? d.packages : []).slice(0, 4).map((x) => {
      const p = (x ?? {}) as Record<string, unknown>;
      return { name: str(p.name, 100), price: str(p.price, 80), includes: str(p.includes, 600), note: str(p.note, 400), ref: true };
    }),
    pricingNote: str(d.pricingNote, 1500),
    // A suggestion only: no end date until the owner sets a real one.
    offer: label ? { label, detail: str(offer.detail, 500), endsAt: "", forNewClients: offer.forNewClients === true } : null,
    videoScript: typeof d.videoScript === "string" ? d.videoScript.trim().slice(0, 1200) : "",
    photoIdeas: (Array.isArray(d.photoIdeas) ? d.photoIdeas : []).map((x) => str(x, 400)).filter(Boolean).slice(0, 6),
    campaignType: str(d.campaignType, 400),
    growth: (() => {
      const g = (d.growth ?? {}) as Record<string, unknown>;
      return {
        diagnosis: plan.mode === "existing" ? str(g.diagnosis, 600) : "",
        idealClient: plan.mode === "existing" ? str(g.idealClient, 400) : "",
        priceVsMarket: plan.mode === "existing" ? str(g.priceVsMarket, 600) : "",
        actions: (Array.isArray(g.actions) ? g.actions : []).map((x) => str(x, 600)).filter(Boolean).slice(0, 3),
      };
    })(),
    channels: (Array.isArray(d.channels) ? d.channels : []).slice(0, 4).map((x) => {
      const c = (x ?? {}) as Record<string, unknown>;
      return { channel: str(c.channel, 120), why: str(c.why, 400) };
    }),
    faq: (Array.isArray(d.faq) ? d.faq : []).slice(0, 8).map((x) => {
      const f = (x ?? {}) as Record<string, unknown>;
      return { q: str(f.q, 240), a: str(f.a, 900) };
    }),
    ...(isAgent ? { agent: parsePlanAgent(d.agent) } : {}),
    message: safeMessage(str(d.message, 1200), plan, d, lang),
  };
}


// In code, before the model ever sees them: nothing the person NEVER wants,
// no idea they already rejected (not even renamed), and "no sé" named only
// where they really said it.
export function filterIdeas(plan: BusinessPlan, list: Idea[]): Idea[] {
  let researched = list;
  const terms = avoidTerms(plan.profile.notWant);
  const ownTitle = plan.ownIdea ? researched[0]?.title : "";
  if (terms.length) researched = researched.filter((i) => i.title === ownTitle || !touchesAvoid(`${i.title} ${i.why} ${i.what} ${i.steps.join(" ")}`, terms));
  // "Dame otras" never brings back a rejected idea, not even renamed (code check).
  if (plan.rejectedIdeas.length) {
    const fold = (x: string) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    // Same idea with another name: the meaningful words share their roots.
    const STOP = new Set("de del la las el los y e o u para por con sin en a al un una unos unas tu su sus tus of the and or for with to in on a an your".split(" "));
    const roots = (x: string) => new Set(fold(x).split(" ").filter((w) => w.length >= 3 && !STOP.has(w)).map((w) => w.slice(0, 4)));
    const same = (a: string, b: string) => {
      const x = roots(a);
      const y = roots(b);
      if (!x.size || !y.size) return false;
      let n = 0;
      for (const w of x) if (y.has(w)) n++;
      return n / (x.size + y.size - n) >= 0.5;
    };
    researched = researched.filter((i) => i.title === ownTitle || !plan.rejectedIdeas.some((r) => fold(r) === fold(i.title) || similar(r, i.title) >= 0.5 || same(r, i.title)));
  }
  // Only "no sé" answers can be named as unknown on a card.
  const unknown = new Set(Object.entries(plan.cards).filter(([, a]) => a.u).map(([id]) => id));
  researched = researched.map((i) => ({ ...i, usesUnknown: i.usesUnknown.filter((x) => unknown.has(x)) }));
  return researched;
}

export async function pickIdeas(plan: BusinessPlan, researchedIn: Idea[], lang: Lang): Promise<{ ideas: Idea[]; message: string }> {
  // B sees more options (people starting from zero want to compare); C keeps 3.
  let researched = researchedIn;
  const count = plan.mode === "agent" ? 3 : 10;
  // What they hate or never want again is a hard filter, applied in code:
  // those ideas never get to the model (their own idea is always kept).
  researched = filterIdeas(plan, researched);
  // Nothing left after the filters (all rejected or off-limits): no model call;
  // the pipeline then researches new ideas instead of re-picking from none.
  if (!researched.length) return { ideas: [], message: "" };
  const d = await ask(
    `${STRATEGIST}\n\n${langLine(lang)}`,
    `${plan.mode === "agent" ? "Persona C: son ideas de agente de IA; usa los puntajes de \"Ideas de agente\".\n\n" : ""}Perfil (JSON):\n${JSON.stringify(plan.profile)}${plan.rejectedIdeas.length ? `\n\nIdeas que ya rechazó (no las repitas ni propongas variantes): ${JSON.stringify(plan.rejectedIdeas.slice(-80))}` : ""}${plan.ideaPrefs ? `\n\nLo que dijo que prefiere o no le gustó: ${plan.ideaPrefs}` : ""}\n\nIdeas investigadas (JSON, con índice):\n${JSON.stringify(researched.map((r, index) => ({ index, ...r })))}\n\n${plan.ownIdea ? "La idea de índice 0 es la que trajo la persona: inclúyela siempre entre las 3, con su puntaje real y sus pros y contras honestos; en message di en una línea cómo salió frente a las otras. " : ""}${plan.mode === "agent" ? `Escoge las ${count} mejores con su puntaje.` : `Escoge las mejores, entre 8 y ${count} (todas las que valgan la pena), con su puntaje: bien pagadas, con demanda real y que encajen con la persona.`}`,
    IDEAS_SCHEMA
  );
  const picked: Idea[] = [];
  const fitOf = new Map<string, number>();
  for (const x of Array.isArray(d.ideas) ? d.ideas : []) {
    const o = (x ?? {}) as Record<string, number | string>;
    const base = researched[Number(o.index)];
    if (!base || picked.some((p) => p.title === base.title)) continue;
    const pts = ["fit", "demand", "cost", "requirements", "speed"].reduce((a, k) => a + Math.max(0, Math.min(5, Number(o[k]) || 0)), 0);
    fitOf.set(base.title, Math.max(0, Math.min(5, Number(o.fit) || 0)));
    picked.push({ ...base, pros: str(o.pros, 600), cons: str(o.cons, 600), score: pts });
    if (picked.length === count) break;
  }
  // Their own idea (researched first) is always shown, with its score.
  const own = plan.ownIdea ? researched[0] : null;
  if (own && !picked.some((p) => p.title === own.title)) picked.splice(count - 1, 1), picked.unshift({ ...own, score: 0 });
  else if (own) {
    const i = picked.findIndex((p) => p.title === own.title);
    if (i > 0) picked.unshift(...picked.splice(i, 1));
  }
  // B: what fits this person best first (fit counts twice in the score),
  // and between two that fit the same, the best paid per hour. A math
  // teacher used to get Power BI first because it paid more; her own classes
  // weren't even in the top 3. (Their own idea stays first.)
  if (plan.mode !== "agent") {
    const head = own ? picked.slice(0, 1) : [];
    const rank = (i: Idea) => i.score + (fitOf.get(i.title) ?? 0);
    const rest = (own ? picked.slice(1) : picked).sort((a, b) => rank(b) - rank(a) || (b.hourlyUsd ?? -1) - (a.hourlyUsd ?? -1));
    picked.splice(0, picked.length, ...head, ...rest);
  }
  return { ideas: parseIdeas(picked), message: str(d.message, 1000) };
}
