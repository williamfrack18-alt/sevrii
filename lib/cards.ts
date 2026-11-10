// The Brain's interview as structured cards (discovery and existing service).
// One card per question, in order. Nothing is proposed or researched until
// every card has an answer or an explicit "no sé" (checked in code, see
// lib/plan.ts missingProfile and app/planActions.ts saveCardsAction).
// Shared by the screen and the server: no server-only imports here.

type L = { es: string; en: string };

export type CardChoice = { id: string; label: L };
export type CardDef = {
  id: string;
  title: L;
  help: L;
  placeholder: L;
  // The "no sé / no tengo" button (absent = the card can't be skipped).
  unknown?: L;
  // Shown under the box and filtered while the person types.
  suggestions: { es: string[]; en: string[] };
  // A required choice (digital / physical…), and a place box for some choices.
  choices?: CardChoice[];
  placeFor?: string[]; // choices that also ask the city / area
  placeAlways?: boolean;
  // The text is optional once a choice is picked.
  choiceIsEnough?: boolean;
};

export type CardAnswer = { v: string; u: boolean; c: string; p: string };
export type CardAnswers = Record<string, CardAnswer>;

const TALENTS = {
  es: ["Cocinar", "Hacer pasteles y postres", "Reparar cosas", "Limpiar y organizar", "Manejar", "Cuidar niños", "Cuidar personas mayores", "Cuidar mascotas", "Jardinería", "Maquillaje y peinado", "Uñas", "Barbería", "Costura y arreglos de ropa", "Carpintería", "Pintar casas", "Electricidad", "Plomería", "Mecánica de carros", "Computadoras", "Redes sociales", "Diseño gráfico", "Fotografía", "Editar videos", "Enseñar y dar clases", "Idiomas", "Contabilidad", "Vender", "Atención al cliente", "Organizar eventos", "Mudanzas", "Manualidades", "Escribir"],
  en: ["Cooking", "Baking and desserts", "Fixing things", "Cleaning and organizing", "Driving", "Childcare", "Senior care", "Pet care", "Gardening", "Makeup and hair", "Nails", "Barbering", "Sewing and alterations", "Carpentry", "House painting", "Electrical work", "Plumbing", "Car mechanics", "Computers", "Social media", "Graphic design", "Photography", "Video editing", "Teaching and tutoring", "Languages", "Bookkeeping", "Sales", "Customer service", "Event planning", "Moving", "Crafts", "Writing"],
};

const DISCOVERY: CardDef[] = [
  {
    id: "talent",
    title: { es: "¿Qué sabes hacer? ¿En qué tienes talento?", en: "What can you do? What are you good at?" },
    help: { es: "Lo que te sale bien, aunque nunca lo hayas cobrado.", en: "What you're good at, even if you've never charged for it." },
    placeholder: { es: "Escribe o escoge abajo…", en: "Type or pick below…" },
    unknown: { es: "No sé", en: "I don't know" },
    suggestions: TALENTS,
  },
  {
    id: "experience",
    title: { es: "¿En qué tienes experiencia?", en: "What experience do you have?" },
    help: { es: "Trabajos, oficios, estudios o cosas que ya hiciste.", en: "Jobs, trades, studies or things you've already done." },
    placeholder: { es: "Ej.: 5 años en restaurantes, curso de uñas…", en: "E.g. 5 years in restaurants, a nail course…" },
    unknown: { es: "No tengo", en: "I have none" },
    suggestions: {
      es: ["Restaurantes y cocina", "Limpieza", "Construcción", "Bodegas y almacén", "Tiendas y ventas", "Oficina", "Cuidado de personas", "Belleza", "Choferes y entregas", "Fábricas", "Escuelas", "Hoteles", "Call center", "Estudios universitarios", "Cursos técnicos"],
      en: ["Restaurants and kitchens", "Cleaning", "Construction", "Warehouses", "Retail and sales", "Office work", "Caregiving", "Beauty", "Driving and delivery", "Factories", "Schools", "Hotels", "Call center", "College studies", "Technical courses"],
    },
  },
  {
    id: "likes",
    title: { es: "¿Qué te gusta hacer?", en: "What do you enjoy doing?" },
    help: { es: "Lo que harías con gusto muchas horas.", en: "What you'd happily do for hours." },
    placeholder: { es: "Escribe o escoge abajo…", en: "Type or pick below…" },
    unknown: { es: "No sé", en: "I don't know" },
    suggestions: {
      es: ["Estar con gente", "Trabajar solo", "Trabajar con las manos", "Trabajar desde casa", "Estar al aire libre", "Crear cosas", "Enseñar", "Ayudar a otros", "Cocinar", "Manejar", "Arreglar cosas", "Usar la computadora", "Las redes sociales", "Los animales", "Los niños", "La moda y la belleza"],
      en: ["Being with people", "Working alone", "Working with my hands", "Working from home", "Being outdoors", "Making things", "Teaching", "Helping others", "Cooking", "Driving", "Fixing things", "Using the computer", "Social media", "Animals", "Kids", "Fashion and beauty"],
    },
  },
  {
    id: "notWant",
    title: { es: "¿Qué NO quieres hacer bajo ningún concepto?", en: "What will you NOT do, no matter what?" },
    help: { es: "Lo que odias o nunca harías. Es un límite: nada de esto aparecerá en tus propuestas.", en: "What you hate or would never do. It's a hard limit: none of it will show up in your proposals." },
    placeholder: { es: "Ej.: limpiar baños, vender por teléfono…", en: "E.g. cleaning bathrooms, phone sales…" },
    unknown: { es: "Nada en especial", en: "Nothing in particular" },
    suggestions: {
      es: ["Limpiar baños", "Vender por teléfono", "Vender puerta a puerta", "Trabajar de noche", "Manejar largas distancias", "Cargar cosas pesadas", "Trabajar en la calle", "Estar todo el día en la computadora", "Cuidar niños", "Trabajar con animales", "Cocinar", "Hablar en público"],
      en: ["Cleaning bathrooms", "Phone sales", "Door-to-door sales", "Working nights", "Long-distance driving", "Heavy lifting", "Working on the street", "Being at a computer all day", "Childcare", "Working with animals", "Cooking", "Public speaking"],
    },
  },
  {
    id: "resources",
    title: { es: "¿Qué tienes?", en: "What do you have?" },
    help: { es: "Carro, herramientas, equipo, dinero para empezar, un local…", en: "Car, tools, equipment, money to start, a space…" },
    placeholder: { es: "Ej.: carro, computadora, $500 para empezar…", en: "E.g. car, laptop, $500 to start…" },
    unknown: { es: "No tengo nada de eso", en: "I have none of that" },
    suggestions: {
      es: ["Carro", "Camioneta", "Herramientas", "Computadora", "Celular con buena cámara", "Cocina equipada", "Local", "Máquina de coser", "Impresora", "$200 para empezar", "$500 para empezar", "$1,000 para empezar", "Licencia de manejo"],
      en: ["Car", "Truck or van", "Tools", "Laptop", "Phone with a good camera", "Equipped kitchen", "A space or shop", "Sewing machine", "Printer", "$200 to start", "$500 to start", "$1,000 to start", "Driver's license"],
    },
  },
  {
    id: "time",
    title: { es: "¿Cuánto tiempo tienes?", en: "How much time do you have?" },
    help: { es: "Horas por semana y días disponibles.", en: "Hours per week and the days you're free." },
    placeholder: { es: "Ej.: 15 horas por semana, fines de semana…", en: "E.g. 15 hours a week, weekends…" },
    unknown: { es: "No sé", en: "I don't know" },
    suggestions: {
      es: ["5 horas por semana", "10 horas por semana", "20 horas por semana", "40 horas por semana", "Fines de semana", "Entre semana", "Mañanas", "Tardes", "Noches"],
      en: ["5 hours a week", "10 hours a week", "20 hours a week", "40 hours a week", "Weekends", "Weekdays", "Mornings", "Afternoons", "Evenings"],
    },
  },
  {
    id: "delivery",
    title: { es: "¿Lo quieres digital, físico, o te da igual?", en: "Digital, in person, or either?" },
    help: { es: "Digital: desde casa por internet. Físico: en persona, en tu zona.", en: "Digital: from home over the internet. In person: in your area." },
    placeholder: { es: "Tu ciudad y estado (ej.: Houston, TX)", en: "Your city and state (e.g. Houston, TX)" },
    unknown: { es: "No sé", en: "I don't know" },
    suggestions: { es: [], en: [] },
    choices: [
      { id: "digital", label: { es: "Digital", en: "Digital" } },
      { id: "fisico", label: { es: "Físico", en: "In person" } },
      { id: "igual", label: { es: "Me da igual", en: "Either" } },
    ],
    placeFor: ["fisico", "igual"],
    choiceIsEnough: true,
  },
  {
    id: "income",
    title: { es: "¿Cuánto dinero quieres o necesitas ganar?", en: "How much do you want or need to earn?" },
    help: { es: "Un rango está bien.", en: "A range is fine." },
    placeholder: { es: "Ej.: $1,000 a $2,000 al mes", en: "E.g. $1,000 to $2,000 a month" },
    unknown: { es: "No sé", en: "I don't know" },
    suggestions: {
      es: ["$500 al mes extra", "$1,000 a $2,000 al mes", "$2,000 a $4,000 al mes", "Más de $4,000 al mes"],
      en: ["$500 a month extra", "$1,000 to $2,000 a month", "$2,000 to $4,000 a month", "Over $4,000 a month"],
    },
  },
];

const EXISTING: CardDef[] = [
  {
    id: "service",
    title: { es: "¿Qué servicio ofreces y dónde?", en: "What service do you offer, and where?" },
    help: { es: "El servicio, y tu ciudad y estado (o «en línea»).", en: "The service, and your city and state (or \"online\")." },
    placeholder: { es: "Ej.: reparación de zapatos", en: "E.g. shoe repair" },
    suggestions: TALENTS,
    placeAlways: true,
  },
  {
    id: "prices",
    title: { es: "¿Cuánto cobras hoy?", en: "What do you charge today?" },
    help: { es: "Tus precios de hoy, con su unidad (por trabajo, por hora, por visita).", en: "Your prices today, with their unit (per job, per hour, per visit)." },
    placeholder: { es: "Ej.: $35 suela, $50 tapas y suela", en: "E.g. $35 soles, $50 heels and soles" },
    unknown: { es: "No lo sé todavía", en: "I don't know yet" },
    suggestions: { es: ["Por trabajo", "Por hora", "Por visita", "Por mes"], en: ["Per job", "Per hour", "Per visit", "Per month"] },
  },
  {
    id: "costs",
    title: { es: "¿Qué costos tienes?", en: "What costs do you have?" },
    help: { es: "Materiales, gasolina, renta, herramientas… con montos si los sabes.", en: "Materials, gas, rent, tools… with amounts if you know them." },
    placeholder: { es: "Ej.: $8 de materiales por par, renta $600 al mes", en: "E.g. $8 of materials per pair, rent $600 a month" },
    unknown: { es: "No lo sé", en: "I don't know" },
    suggestions: { es: ["Materiales", "Gasolina", "Renta del local", "Herramientas", "Seguro", "Publicidad"], en: ["Materials", "Gas", "Rent", "Tools", "Insurance", "Advertising"] },
  },
  {
    id: "hours",
    title: { es: "¿Cuántas horas trabajas o puedes trabajar?", en: "How many hours do you work, or can you?" },
    help: { es: "Por semana, y cuánto te toma un trabajo si lo sabes.", en: "Per week, and how long one job takes if you know." },
    placeholder: { es: "Ej.: 30 horas por semana, 1 hora por par", en: "E.g. 30 hours a week, 1 hour per pair" },
    unknown: { es: "No lo sé", en: "I don't know" },
    suggestions: { es: ["10 horas por semana", "20 horas por semana", "40 horas por semana", "Fines de semana"], en: ["10 hours a week", "20 hours a week", "40 hours a week", "Weekends"] },
  },
  {
    id: "clients",
    title: { es: "¿A qué clientes atiendes hoy?", en: "Who are your customers today?" },
    help: { es: "Quiénes son, cuántos más o menos y cómo te llegan.", en: "Who they are, roughly how many, and how they find you." },
    placeholder: { es: "Ej.: vecinos del barrio, unos 15 por semana, por recomendación", en: "E.g. neighbors, about 15 a week, by referral" },
    unknown: { es: "Todavía no tengo", en: "None yet" },
    suggestions: { es: ["Familias del barrio", "Negocios pequeños", "Por recomendación", "Por redes sociales", "Clientes fijos"], en: ["Local families", "Small businesses", "By referral", "Through social media", "Regular customers"] },
  },
  {
    id: "assets",
    title: { es: "¿Qué recursos tienes?", en: "What resources do you have?" },
    help: { es: "Local, herramientas, carro, equipo, dinero para invertir…", en: "A shop, tools, car, equipment, money to invest…" },
    placeholder: { es: "Ej.: local propio, máquina de coser", en: "E.g. own shop, sewing machine" },
    unknown: { es: "Nada en especial", en: "Nothing in particular" },
    suggestions: { es: ["Local propio", "Herramientas", "Carro", "Camioneta", "Computadora", "Equipo profesional", "Dinero para invertir"], en: ["Own shop", "Tools", "Car", "Truck or van", "Laptop", "Professional equipment", "Money to invest"] },
  },
  {
    id: "goal",
    title: { es: "¿Qué quieres lograr?", en: "What do you want to achieve?" },
    help: { es: "Tu meta principal con Sevrii.", en: "Your main goal with Sevrii." },
    placeholder: { es: "Cuéntame más si quieres (opcional)", en: "Tell me more if you like (optional)" },
    unknown: { es: "No lo sé", en: "I don't know" },
    suggestions: { es: [], en: [] },
    choices: [
      { id: "clients", label: { es: "Más clientes", en: "More customers" } },
      { id: "price", label: { es: "Cobrar mejor", en: "Charge more" } },
      { id: "hours", label: { es: "Trabajar más horas", en: "Work more hours" } },
      { id: "new", label: { es: "Ofrecer algo nuevo", en: "Offer something new" } },
    ],
    choiceIsEnough: true,
  },
];

export function cardsFor(mode: string): CardDef[] {
  return mode === "new" ? DISCOVERY : mode === "existing" ? EXISTING : [];
}

export function emptyAnswer(): CardAnswer {
  return { v: "", u: false, c: "", p: "" };
}

// "en línea", but also "en línea, todo EE. UU." or "online (US)": an answer
// that starts by saying online is online, not a city named "online, …".
const ONLINE = /^(en\s*l[ií]nea|online|remot[oa]|remote|por\s+internet|internet|virtual)(?![\p{L}\d])/iu;
export const isOnlinePlace = (p: string) => ONLINE.test(p.trim());

// A typed "I don't know" (the whole answer, nothing else).
const DONT_KNOW = /^\s*(no\s+(lo\s+)?s[eé]( todav[ií]a| a[uú]n)?|no\s+tengo\s+idea|ni\s+idea|n\/a|i\s+don'?t\s+know( yet)?|not\s+sure|idk)\s*[.!]*\s*$/i;

// A card counts as answered with text, a pick, or an explicit "no sé".
export function cardDone(def: CardDef, a: CardAnswer | undefined): boolean {
  if (!a) return false;
  if (def.unknown && a.u) return true;
  if (def.choices && !def.choices.some((c) => c.id === a.c)) return false;
  const needsPlace = def.placeAlways || (def.placeFor?.includes(a.c) ?? false);
  // In person (or either) needs the city to research the area; the service
  // card always needs where (a city, or "en línea").
  if (needsPlace && (!a.p.trim() || DONT_KNOW.test(a.p))) return false;
  if (def.choices && def.choiceIsEnough) return true;
  return a.v.trim().length > 0;
}

export function pendingCards(mode: string, answers: CardAnswers): string[] {
  return cardsFor(mode)
    .filter((d) => !cardDone(d, answers[d.id]))
    .map((d) => d.id);
}

// The cards the person answered "no sé" / "no tengo".
export function unknownCards(mode: string, answers: CardAnswers): string[] {
  return cardsFor(mode)
    .filter((d) => answers[d.id]?.u)
    .map((d) => d.id);
}

export function cardTitle(mode: string, id: string, lang: "es" | "en"): string {
  return cardsFor(mode).find((d) => d.id === id)?.title[lang] ?? id;
}

// Answers as they come from the screen: only known cards, plain short text.
export function cleanAnswers(mode: string, raw: unknown): CardAnswers {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: CardAnswers = {};
  for (const d of cardsFor(mode)) {
    const a = src[d.id];
    if (!a || typeof a !== "object") continue;
    const o = a as Record<string, unknown>;
    const txt = (x: unknown, n: number) => (typeof x === "string" ? x.replace(/\s+/g, " ").trim().slice(0, n) : "");
    const c = txt(o.c, 20);
    const v = txt(o.v, 400);
    // "no sé" typed in the box is the same as the "No sé" button: it stays
    // unknown (it used to be saved as their price, their limit… or, in the
    // place box, as a city called "no sé" that the research searched).
    const typedUnknown = Boolean(d.unknown) && DONT_KNOW.test(v) && !c;
    const p = txt(o.p, 80);
    out[d.id] = {
      v: typedUnknown ? "" : v,
      u: Boolean(d.unknown) && (o.u === true || typedUnknown),
      c: d.choices?.some((x) => x.id === c) ? c : "",
      p: DONT_KNOW.test(p) ? "" : p,
    };
  }
  return out;
}

// Accent-insensitive search over a card's suggestions (the "buscador").
const fold = (x: string) => x.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export function suggest(def: CardDef, lang: "es" | "en", typed: string, max = 10): string[] {
  const all = def.suggestions[lang];
  const last = fold(typed.split(/[,;]/).pop() ?? "").trim();
  const picked = new Set(typed.split(/[,;]/).map((x) => fold(x).trim()).filter(Boolean));
  const pool = all.filter((s) => !picked.has(fold(s)));
  if (!last) return pool.slice(0, max);
  return pool.filter((s) => fold(s).includes(last)).slice(0, max);
}
