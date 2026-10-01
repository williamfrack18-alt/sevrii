// Simulated "Sevrii AI" logic.
//
// These functions stand in for a real LLM call. They are intentionally
// isolated behind plain functions so that swapping in a real model later
// (OpenAI, Anthropic, etc.) only means changing the implementation here —
// nothing in the UI or database layer needs to change.
//
// Important: this app generates content for real businesses that real users
// will publish. It never fabricates customer reviews, testimonials, or
// performance numbers — those stay empty/zero until the business owner (or
// a real connected data source) provides them.

import type { Lang } from "./i18n";

export const CATEGORIES = [
  "Appliance repair",
  "Home carpentry",
  "Cleaning services",
  "Landscaping",
  "Plumbing",
  "Electrical",
  "HVAC",
  "Handyman",
  "Other",
] as const;

export type Category = (typeof CATEGORIES)[number];

const STARTER_SERVICES: Record<string, { name: string; price: string }[]> = {
  "Appliance repair": [
    { name: "Diagnostic visit", price: "From $45" },
    { name: "Washer / dryer repair", price: "From $95" },
    { name: "Refrigerator repair", price: "From $110" },
  ],
  "Home carpentry": [
    { name: "Custom shelving", price: "Quote on request" },
    { name: "Door & trim repair", price: "From $80" },
    { name: "Furniture assembly", price: "From $60" },
  ],
  "Cleaning services": [
    { name: "Standard home clean", price: "From $90" },
    { name: "Deep clean", price: "From $150" },
    { name: "Move-in / move-out clean", price: "From $180" },
  ],
  Landscaping: [
    { name: "Lawn maintenance", price: "From $50/visit" },
    { name: "Seasonal cleanup", price: "From $120" },
    { name: "Garden design", price: "Quote on request" },
  ],
  Plumbing: [
    { name: "Leak repair", price: "From $85" },
    { name: "Drain cleaning", price: "From $95" },
    { name: "Fixture installation", price: "From $70" },
  ],
  Electrical: [
    { name: "Electrical inspection", price: "From $75" },
    { name: "Outlet & switch repair", price: "From $60" },
    { name: "Panel upgrade", price: "Quote on request" },
  ],
  HVAC: [
    { name: "AC tune-up", price: "From $90" },
    { name: "Heating repair", price: "From $100" },
    { name: "Filter & maintenance plan", price: "From $30/mo" },
  ],
  Handyman: [
    { name: "General repairs", price: "From $55/hr" },
    { name: "Mounting & installs", price: "From $50" },
    { name: "Small home projects", price: "Quote on request" },
  ],
  Other: [
    { name: "Initial consultation", price: "Free" },
    { name: "Standard service", price: "Quote on request" },
  ],
};

// Spanish labels for the same categories (the English names above are the
// canonical keys used for lookups).
const CATEGORY_LABELS_ES: Record<Category, string> = {
  "Appliance repair": "Reparación de electrodomésticos",
  "Home carpentry": "Carpintería",
  "Cleaning services": "Servicios de limpieza",
  Landscaping: "Jardinería",
  Plumbing: "Plomería",
  Electrical: "Electricidad",
  HVAC: "Aire acondicionado y calefacción",
  Handyman: "Reparaciones del hogar",
  Other: "Otro",
};

// Extra words people commonly type in Spanish for each category.
const CATEGORY_SYNONYMS_ES: Record<Exclude<Category, "Other">, string[]> = {
  "Appliance repair": ["electrodoméstic", "nevera", "lavadora", "secadora", "refrigerador"],
  "Home carpentry": ["carpinter", "madera", "mueble"],
  "Cleaning services": ["limpieza", "aseo", "limpiar"],
  Landscaping: ["jardín", "jardin", "jardiner", "césped", "cesped", "pasto"],
  Plumbing: ["plomer", "fontaner", "tuber", "plomería"],
  Electrical: ["electric", "eléctric"],
  HVAC: ["aire acondicionado", "calefacc", "climatiz"],
  Handyman: ["reparacion", "reparación", "mantenimiento", "arreglos", "todero"],
};

// Starter services in Spanish. Prices are left as "Precio a convenir" on
// purpose: the English list uses USD amounts that don't make sense in other
// currencies, and the owner sets real prices from the dashboard chat.
const STARTER_SERVICES_ES: Record<string, { name: string; price: string }[]> = {
  "Appliance repair": [
    { name: "Visita de diagnóstico", price: "Precio a convenir" },
    { name: "Reparación de lavadoras y secadoras", price: "Precio a convenir" },
    { name: "Reparación de neveras", price: "Precio a convenir" },
  ],
  "Home carpentry": [
    { name: "Repisas a la medida", price: "Precio a convenir" },
    { name: "Reparación de puertas y marcos", price: "Precio a convenir" },
    { name: "Armado de muebles", price: "Precio a convenir" },
  ],
  "Cleaning services": [
    { name: "Limpieza del hogar", price: "Precio a convenir" },
    { name: "Limpieza profunda", price: "Precio a convenir" },
    { name: "Limpieza de mudanza", price: "Precio a convenir" },
  ],
  Landscaping: [
    { name: "Mantenimiento de césped", price: "Precio a convenir" },
    { name: "Limpieza de temporada", price: "Precio a convenir" },
    { name: "Diseño de jardines", price: "Precio a convenir" },
  ],
  Plumbing: [
    { name: "Reparación de fugas", price: "Precio a convenir" },
    { name: "Destape de tuberías", price: "Precio a convenir" },
    { name: "Instalación de griferías", price: "Precio a convenir" },
  ],
  Electrical: [
    { name: "Revisión eléctrica", price: "Precio a convenir" },
    { name: "Reparación de tomas e interruptores", price: "Precio a convenir" },
    { name: "Cambio de tablero eléctrico", price: "Precio a convenir" },
  ],
  HVAC: [
    { name: "Mantenimiento de aire acondicionado", price: "Precio a convenir" },
    { name: "Reparación de calefacción", price: "Precio a convenir" },
    { name: "Plan de mantenimiento", price: "Precio a convenir" },
  ],
  Handyman: [
    { name: "Reparaciones generales", price: "Precio a convenir" },
    { name: "Instalaciones y montajes", price: "Precio a convenir" },
    { name: "Pequeños proyectos del hogar", price: "Precio a convenir" },
  ],
  Other: [
    { name: "Consulta inicial", price: "Gratis" },
    { name: "Servicio estándar", price: "Precio a convenir" },
  ],
};

// Accepts either the English key or the Spanish label.
function categoryKey(category: string): Category {
  const found = CATEGORIES.find((c) => c === category || CATEGORY_LABELS_ES[c] === category);
  return found ?? "Other";
}

export function categoryLabel(category: Category, lang: Lang = "en"): string {
  return lang === "es" ? CATEGORY_LABELS_ES[category] : category;
}

export function suggestServices(category: string, lang: Lang = "en") {
  const key = categoryKey(category);
  const bank = lang === "es" ? STARTER_SERVICES_ES : STARTER_SERVICES;
  return bank[key] ?? bank.Other;
}

export function generatePitch(opts: {
  name: string;
  category: string;
  description: string;
  city?: string;
  lang?: Lang;
}): string {
  const { name, category, description, city, lang = "en" } = opts;
  const trimmedDesc = description.trim().replace(/\.$/, "");
  if (lang === "es") {
    const place = city ? ` en ${city}` : " en tu zona";
    return `${name}: ${category.toLowerCase()} de confianza${place}. ${trimmedDesc}. Escríbenos y te respondemos el mismo día.`;
  }
  const place = city ? ` in ${city}` : " in your area";
  return `${name} brings dependable ${category.toLowerCase()}${place}. ${trimmedDesc}. Message us and we'll get back to you the same day.`;
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}

export type OnboardingStep =
  | "ask_name"
  | "ask_category"
  | "ask_city"
  | "ask_description"
  | "done";

export function nextOnboardingPrompt(step: OnboardingStep, lang: Lang = "en"): string {
  if (lang === "es") {
    switch (step) {
      case "ask_name":
        return "¿Cómo se llama tu negocio?";
      case "ask_category":
        return `Perfecto. ¿Qué tipo de trabajo hace? (${CATEGORIES.slice(0, -1)
          .map((c) => CATEGORY_LABELS_ES[c].toLowerCase())
          .join(", ")}, u otra cosa)`;
      case "ask_city":
        return "¿Dónde estás? ¿En qué ciudad o zona atiendes?";
      case "ask_description":
        return "Última pregunta: en una o dos frases, ¿por qué vale la pena llamarte? (en qué te especializas, cuánto tiempo llevas haciéndolo, algo que tus clientes deban saber)";
      case "done":
        return "Perfecto, ya estoy armando tu página.";
    }
  }
  switch (step) {
    case "ask_name":
      return "What's the name of your business?";
    case "ask_category":
      return `Got it. What kind of work does it do? (${CATEGORIES.slice(0, -1).join(", ")}, or something else)`;
    case "ask_city":
      return "Where are you based — what city or area do you serve?";
    case "ask_description":
      return "Last one: in a sentence or two, what makes your work worth calling? (what you specialize in, how long you've been doing it, anything customers should know)";
    case "done":
      return "Perfect — building your page now.";
  }
}

export function matchCategory(input: string, lang: Lang = "en"): string {
  const lower = input.toLowerCase();
  const found =
    CATEGORIES.find((c) => lower.includes(c.toLowerCase()) || lower.includes(CATEGORY_LABELS_ES[c].toLowerCase())) ??
    (Object.entries(CATEGORY_SYNONYMS_ES) as [Category, string[]][]).find(([, words]) =>
      words.some((w) => lower.includes(w))
    )?.[0];
  return categoryLabel(found ?? "Other", lang);
}

// Marketing chat: proposes a campaign DRAFT. It never claims the campaign is
// live or reports fabricated results — those stay at zero until a real ad
// account is connected.
export function draftCampaign(opts: { businessName: string; category: string; goal: string }) {
  const { businessName, category, goal } = opts;
  return {
    title: `${goal} — ${businessName}`,
    goal,
    adCopyDraft: `Need ${category.toLowerCase()}? ${businessName} is taking new customers this week. Message us on WhatsApp for a free quote.`,
    suggestedBudget: "Start at $10/day, adjust after the first week",
  };
}

// ============================================================================
// "I want to offer a service, but I'm not sure what" — the discovery path.
// Mirrors the Bifurcación → discovery chat → analysis → ideas → details chat
// → proposal flow from the design prototype, wired to real generated content
// instead of a fixed example (no hardcoded city/business — everything below
// is derived from what the person actually types).
// ============================================================================

export type DiscoveryStep =
  | "ask_location"
  | "ask_background"
  | "ask_license"
  | "ask_capacity"
  | "done";

export function nextDiscoveryPrompt(step: DiscoveryStep, lang: Lang = "en"): string {
  if (lang === "es") {
    switch (step) {
      case "ask_location":
        return "¡Hola! Te voy a hacer unas preguntas para encontrar un servicio que te quede bien y por el que la gente de verdad pague. Primero: ¿en qué ciudad y país estás?";
      case "ask_background":
        return "Perfecto. Ahora cuéntame de ti: ¿en qué has trabajado antes, y hay algo en lo que la gente ya te pida ayuda?";
      case "ask_license":
        return "Eso sirve mucho. ¿Tienes alguna licencia o certificación para ese tipo de trabajo, o es algo más general?";
      case "ask_capacity":
        return "Anotado. ¿Cuánto tiempo a la semana podrías dedicarle de verdad, y ya tienes las herramientas o el equipo que necesitarías?";
      case "done":
        return "Perfecto, con eso puedo trabajar. Dame un segundo para armar algunas ideas que encajen con tu experiencia, tu zona y tu tiempo.";
    }
  }
  switch (step) {
    case "ask_location":
      return "Hi! I'm going to ask a few questions to find a service that's a good fit for you — and that people will actually pay for. First: what city and state are you in?";
    case "ask_background":
      return "Got it. Now tell me about you: what have you done for work before, and is there anything people already come to you for help with?";
    case "ask_license":
      return "That's useful. Do you have any licenses or certifications relevant to that kind of work, or is it more general / handyman-level?";
    case "ask_capacity":
      return "Noted. How much time could you realistically give this each week, and do you already have the tools or equipment you'd need?";
    case "done":
      return "Perfect — that's enough for me to work with. Give me a second to put together a few ideas that fit your experience, your area, and your schedule.";
  }
}

export type DiscoveryAnswers = {
  location: string;
  background: string;
  license: string;
  capacity: string;
};

export type Cluster = "construction" | "cleaning" | "landscaping" | "general";

const CLUSTER_KEYWORDS: Record<Exclude<Cluster, "general">, string[]> = {
  construction: [
    "construction",
    "framing",
    "carpentry",
    "carpenter",
    "electrical",
    "electrician",
    "handyman",
    "building",
    "contractor",
    "renovation",
    "remodel",
    "plumbing",
    "plumber",
    "repair",
    "wood",
    "construcc",
    "obra",
    "albañil",
    "carpinter",
    "electric",
    "eléctric",
    "plomer",
    "fontaner",
    "remodel",
    "reparac",
    "madera",
    "soldad",
    "pintor",
  ],
  cleaning: ["clean", "cleaning", "housekeep", "maid", "janitor", "limpi", "aseo", "empleada"],
  landscaping: ["lawn", "garden", "landscap", "yard", "tree", "jardín", "jardin", "césped", "cesped", "pasto", "árbol", "arbol"],
};

export function detectCluster(text: string): Cluster {
  const lower = text.toLowerCase();
  for (const [cluster, keywords] of Object.entries(CLUSTER_KEYWORDS) as [
    Exclude<Cluster, "general">,
    string[],
  ][]) {
    if (keywords.some((k) => lower.includes(k))) return cluster;
  }
  return "general";
}

function hasLicenseSignal(text: string): boolean {
  const lower = text.toLowerCase();
  if (/no license|not licensed|no certification|none|n\/a|no tengo|ninguna|ninguno|sin licencia|sin certific/.test(lower)) return false;
  return /licen|certif/.test(lower);
}

function hasOwnToolsSignal(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    /(own|have|got).{0,15}(tool|truck|van|equipment)/.test(lower) ||
    /tools? and a (truck|van)/.test(lower) ||
    /(tengo|cuento con|ya tengo).{0,20}(herramient|equipo|camioneta|carro|moto)/.test(lower)
  );
}

function hasInformalDemandSignal(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    /(neighbor|friend|family|people).{0,20}(ask|come to me|hire me|call me)/.test(lower) ||
    /already ask/.test(lower) ||
    /(vecin|amig|familia|gente|conocid).{0,25}(me piden|me buscan|me llaman|me contratan|me preguntan)/.test(lower) ||
    /ya me piden/.test(lower)
  );
}

export type Idea = { tag: string; title: string; tagline: string; desc: string; requiresLicense: boolean };

const IDEA_BANK: Record<Cluster, { setA: Idea[]; setB: Idea[] }> = {
  construction: {
    setA: [
      {
        tag: "Higher ticket",
        title: "Custom Home Carpentry",
        tagline: "Custom carpentry, built to last.",
        desc: "Builds directly on hands-on framing and building experience; project-based work usually has better margins than one-off handyman jobs.",
        requiresLicense: false,
      },
      {
        tag: "Recurring service",
        title: "Residential Electrical Maintenance",
        tagline: "Small electrical fixes, done right.",
        desc: "Basic, code-safe fixes homeowners hire out — outlet and fixture swaps, panel labeling. Scope stays within what doesn't require a full electrician's license.",
        requiresLicense: true,
      },
      {
        tag: "Steady local demand",
        title: "Fence & Deck Repair",
        tagline: "Fences and decks, fixed for good.",
        desc: "Draws on hands-on building experience — one of the most requested jobs in residential neighborhoods.",
        requiresLicense: false,
      },
    ],
    setB: [
      {
        tag: "Low startup cost",
        title: "Drywall Patching & Interior Painting",
        tagline: "Clean patch-ups, no mess left behind.",
        desc: "Barely any extra equipment beyond what's already on hand, with fast, repeatable jobs.",
        requiresLicense: false,
      },
      {
        tag: "Recurring referrals",
        title: "Pre-Listing Home Repairs",
        tagline: "Homes, ready to list.",
        desc: "Partner with local real estate agents who need quick fixes before a house goes on the market.",
        requiresLicense: false,
      },
      {
        tag: "Growing trend",
        title: "Small-Scale Solar Panel Installation",
        tagline: "Solar, installed by someone local.",
        desc: "Few specialized providers in most areas yet — a chance to be early. Typically starts working under a licensed installer.",
        requiresLicense: true,
      },
    ],
  },
  cleaning: {
    setA: [
      {
        tag: "Recurring revenue",
        title: "Recurring Home Cleaning",
        tagline: "A clean home, on a schedule.",
        desc: "Weekly or biweekly cleans build a predictable, repeat-customer income base instead of one-off jobs.",
        requiresLicense: false,
      },
      {
        tag: "Higher ticket",
        title: "Move-In / Move-Out Deep Cleans",
        tagline: "Deep cleans for move day.",
        desc: "Higher price per job than a standard clean, and tenants/landlords often need it on short notice.",
        requiresLicense: false,
      },
      {
        tag: "B2B opportunity",
        title: "Small Office Cleaning",
        tagline: "Offices, cleaned after hours.",
        desc: "Small local offices are often underserved by the big commercial cleaning companies and pay reliably on contract.",
        requiresLicense: false,
      },
    ],
    setB: [
      {
        tag: "Low startup cost",
        title: "Post-Construction Cleaning",
        tagline: "The last step before move-in.",
        desc: "Contractors and renovators regularly need this and will refer repeat work if the job is done well.",
        requiresLicense: false,
      },
      {
        tag: "Growing trend",
        title: "Airbnb Turnover Cleaning",
        tagline: "Turnovers, done between guests.",
        desc: "Short-term rental hosts need fast, reliable turnaround between guests — often recurring, scheduled work.",
        requiresLicense: false,
      },
      {
        tag: "Specialty",
        title: "Window & Gutter Cleaning",
        tagline: "The clean most people skip.",
        desc: "Less competition than general home cleaning, and customers usually book it as a seasonal recurring job.",
        requiresLicense: false,
      },
    ],
  },
  landscaping: {
    setA: [
      {
        tag: "Recurring revenue",
        title: "Weekly Lawn Maintenance",
        tagline: "A yard that's always ready.",
        desc: "Weekly or biweekly visits build a predictable route of repeat customers in one area.",
        requiresLicense: false,
      },
      {
        tag: "Seasonal ticket",
        title: "Seasonal Yard Cleanup",
        tagline: "Yards, reset every season.",
        desc: "Spring and fall cleanups are high-demand, higher-ticket jobs that most homeowners don't want to do themselves.",
        requiresLicense: false,
      },
      {
        tag: "Higher ticket",
        title: "Garden Bed Design & Planting",
        tagline: "Gardens, designed and planted.",
        desc: "Design-and-install work has better margins than mowing alone, and referrals travel fast in a neighborhood.",
        requiresLicense: false,
      },
    ],
    setB: [
      {
        tag: "Recurring referrals",
        title: "Pre-Listing Curb Appeal",
        tagline: "Curb appeal, before the listing photos.",
        desc: "Partner with local real estate agents who need a yard looking sharp before photos go up.",
        requiresLicense: false,
      },
      {
        tag: "Specialty",
        title: "Irrigation & Sprinkler Repair",
        tagline: "Sprinklers, fixed for the season.",
        desc: "Less competition than mowing, and often becomes recurring seasonal maintenance work.",
        requiresLicense: false,
      },
      {
        tag: "Growing trend",
        title: "Small Tree & Shrub Care",
        tagline: "Trees and shrubs, kept healthy.",
        desc: "Homeowners increasingly want this handled by someone local rather than a large tree service.",
        requiresLicense: false,
      },
    ],
  },
  general: {
    setA: [
      {
        tag: "Flexible",
        title: "General Handyman Services",
        tagline: "The small jobs, handled.",
        desc: "A wide net of small home repairs and tasks is a fast way to start getting paid while a more specific niche becomes clear.",
        requiresLicense: false,
      },
      {
        tag: "Recurring revenue",
        title: "Errand & Task Support",
        tagline: "The to-do list, done for you.",
        desc: "Busy households and small businesses regularly pay for reliable help with recurring errands and small tasks.",
        requiresLicense: false,
      },
      {
        tag: "Low startup cost",
        title: "Organizing & Setup Help",
        tagline: "Spaces, sorted out.",
        desc: "Little to no equipment needed to start, and word-of-mouth travels quickly once a few jobs are done well.",
        requiresLicense: false,
      },
    ],
    setB: [
      {
        tag: "Recurring referrals",
        title: "Move-In / Move-Out Support",
        tagline: "Move day, made easier.",
        desc: "People moving need help fast and are often willing to pay a premium for someone reliable on short notice.",
        requiresLicense: false,
      },
      {
        tag: "Growing trend",
        title: "Senior Errand & Home Help",
        tagline: "Everyday help, close to home.",
        desc: "A steadily growing need in most areas, with customers who tend to become long-term, recurring clients.",
        requiresLicense: false,
      },
      {
        tag: "Specialty",
        title: "Event Setup & Breakdown",
        tagline: "Events, set up and packed down.",
        desc: "Local hosts and small venues regularly need reliable, short-notice help for setup and cleanup.",
        requiresLicense: false,
      },
    ],
  },
};

// Same idea bank in Spanish — same order and the same requiresLicense flags
// as IDEA_BANK, so the swap logic in generateIdeas behaves identically.
const IDEA_BANK_ES: Record<Cluster, { setA: Idea[]; setB: Idea[] }> = {
  construction: {
    setA: [
      {
        tag: "Mayor ticket",
        title: "Carpintería a la medida",
        tagline: "Carpintería a la medida, hecha para durar.",
        desc: "Se apoya directamente en tu experiencia de obra y construcción; el trabajo por proyecto suele dejar mejor margen que los arreglos sueltos.",
        requiresLicense: false,
      },
      {
        tag: "Servicio recurrente",
        title: "Mantenimiento eléctrico residencial",
        tagline: "Arreglos eléctricos pequeños, bien hechos.",
        desc: "Arreglos básicos y seguros que los hogares contratan: cambio de tomas y lámparas, rotulado de tableros. Se queda dentro de lo que no exige una licencia de electricista completa.",
        requiresLicense: true,
      },
      {
        tag: "Demanda local constante",
        title: "Reparación de cercas y terrazas",
        tagline: "Cercas y terrazas, arregladas para siempre.",
        desc: "Aprovecha tu experiencia práctica en construcción; es uno de los trabajos más pedidos en zonas residenciales.",
        requiresLicense: false,
      },
    ],
    setB: [
      {
        tag: "Baja inversión inicial",
        title: "Resanes de drywall y pintura interior",
        tagline: "Resanes limpios, sin dejar desorden.",
        desc: "Casi no necesitas equipo adicional al que ya tienes, y son trabajos rápidos y repetibles.",
        requiresLicense: false,
      },
      {
        tag: "Referidos recurrentes",
        title: "Arreglos antes de vender una casa",
        tagline: "Casas listas para publicarse.",
        desc: "Alíate con agentes inmobiliarios de tu zona que necesitan arreglos rápidos antes de poner una casa en venta.",
        requiresLicense: false,
      },
      {
        tag: "Tendencia en crecimiento",
        title: "Instalación de paneles solares a pequeña escala",
        tagline: "Energía solar, instalada por alguien local.",
        desc: "Todavía hay pocos proveedores especializados en la mayoría de zonas: una oportunidad de llegar primero. Normalmente se empieza trabajando con un instalador certificado.",
        requiresLicense: true,
      },
    ],
  },
  cleaning: {
    setA: [
      {
        tag: "Ingreso recurrente",
        title: "Limpieza de hogares recurrente",
        tagline: "Una casa limpia, con horario fijo.",
        desc: "Las limpiezas semanales o quincenales construyen una base de clientes fijos con ingresos predecibles, en lugar de trabajos sueltos.",
        requiresLicense: false,
      },
      {
        tag: "Mayor ticket",
        title: "Limpieza profunda de mudanza",
        tagline: "Limpieza profunda para el día de la mudanza.",
        desc: "Se cobra más por trabajo que una limpieza normal, y arrendatarios y propietarios la necesitan con poco aviso.",
        requiresLicense: false,
      },
      {
        tag: "Oportunidad con empresas",
        title: "Limpieza de oficinas pequeñas",
        tagline: "Oficinas limpias, fuera del horario laboral.",
        desc: "Las oficinas pequeñas suelen quedar desatendidas por las grandes empresas de limpieza y pagan de forma confiable por contrato.",
        requiresLicense: false,
      },
    ],
    setB: [
      {
        tag: "Baja inversión inicial",
        title: "Limpieza después de obra",
        tagline: "El último paso antes de habitar.",
        desc: "Contratistas y remodeladores la necesitan seguido y te recomiendan si el trabajo queda bien.",
        requiresLicense: false,
      },
      {
        tag: "Tendencia en crecimiento",
        title: "Limpieza para alquileres tipo Airbnb",
        tagline: "Listo entre un huésped y otro.",
        desc: "Los anfitriones de alquiler temporal necesitan limpiezas rápidas y confiables entre huéspedes, casi siempre de forma recurrente.",
        requiresLicense: false,
      },
      {
        tag: "Especialidad",
        title: "Limpieza de ventanas y canales",
        tagline: "La limpieza que casi todos dejan para después.",
        desc: "Hay menos competencia que en la limpieza general, y los clientes suelen pedirla como un trabajo de temporada que se repite.",
        requiresLicense: false,
      },
    ],
  },
  landscaping: {
    setA: [
      {
        tag: "Ingreso recurrente",
        title: "Mantenimiento semanal de césped",
        tagline: "Un jardín siempre listo.",
        desc: "Las visitas semanales o quincenales arman una ruta predecible de clientes fijos en una misma zona.",
        requiresLicense: false,
      },
      {
        tag: "Ticket de temporada",
        title: "Limpieza de jardines por temporada",
        tagline: "Jardines renovados cada temporada.",
        desc: "Las limpiezas de temporada tienen mucha demanda y mejor precio, y la mayoría de dueños de casa no quiere hacerlas.",
        requiresLicense: false,
      },
      {
        tag: "Mayor ticket",
        title: "Diseño y siembra de jardines",
        tagline: "Jardines diseñados y sembrados.",
        desc: "Diseñar e instalar deja mejor margen que solo podar, y las recomendaciones corren rápido en un barrio.",
        requiresLicense: false,
      },
    ],
    setB: [
      {
        tag: "Referidos recurrentes",
        title: "Fachadas listas para vender",
        tagline: "Buena primera impresión antes de las fotos.",
        desc: "Alíate con agentes inmobiliarios que necesitan que el jardín se vea impecable antes de tomar las fotos de la venta.",
        requiresLicense: false,
      },
      {
        tag: "Especialidad",
        title: "Reparación de riego y aspersores",
        tagline: "Riego arreglado para la temporada.",
        desc: "Hay menos competencia que en el corte de césped, y muchas veces se vuelve un mantenimiento de temporada recurrente.",
        requiresLicense: false,
      },
      {
        tag: "Tendencia en crecimiento",
        title: "Cuidado de árboles y arbustos pequeños",
        tagline: "Árboles y arbustos sanos.",
        desc: "Cada vez más dueños de casa prefieren que esto lo haga alguien local en lugar de una gran empresa.",
        requiresLicense: false,
      },
    ],
  },
  general: {
    setA: [
      {
        tag: "Flexible",
        title: "Reparaciones generales del hogar",
        tagline: "Los arreglos pequeños, resueltos.",
        desc: "Cubrir muchos arreglos pequeños es una forma rápida de empezar a cobrar mientras se aclara un nicho más específico.",
        requiresLicense: false,
      },
      {
        tag: "Ingreso recurrente",
        title: "Diligencias y tareas",
        tagline: "Tu lista de pendientes, resuelta.",
        desc: "Hogares ocupados y negocios pequeños pagan seguido por ayuda confiable con diligencias y tareas recurrentes.",
        requiresLicense: false,
      },
      {
        tag: "Baja inversión inicial",
        title: "Organización de espacios",
        tagline: "Espacios ordenados.",
        desc: "Casi no necesitas equipo para empezar, y la recomendación boca a boca se mueve rápido después de unos buenos trabajos.",
        requiresLicense: false,
      },
    ],
    setB: [
      {
        tag: "Referidos recurrentes",
        title: "Apoyo en mudanzas",
        tagline: "El día de la mudanza, más fácil.",
        desc: "Quien se está mudando necesita ayuda rápido y suele pagar más por alguien confiable con poco aviso.",
        requiresLicense: false,
      },
      {
        tag: "Tendencia en crecimiento",
        title: "Ayuda en casa para adultos mayores",
        tagline: "Ayuda del día a día, cerca de casa.",
        desc: "Una necesidad que crece en casi todas las zonas, con clientes que tienden a quedarse por mucho tiempo.",
        requiresLicense: false,
      },
      {
        tag: "Especialidad",
        title: "Montaje y desmontaje de eventos",
        tagline: "Eventos armados y recogidos.",
        desc: "Anfitriones y salones pequeños necesitan seguido ayuda confiable y con poco aviso para montar y recoger.",
        requiresLicense: false,
      },
    ],
  },
};

export function generateIdeas(cluster: Cluster, altSet: boolean, hasLicense: boolean, lang: Lang = "en"): Idea[] {
  const BANK = lang === "es" ? IDEA_BANK_ES : IDEA_BANK;
  const pool = altSet ? BANK[cluster].setB : BANK[cluster].setA;
  // Swap out anything requiring a license the person doesn't have for the
  // next idea in the other set, so we never show an idea we'd immediately
  // have to rule out.
  const backup = (altSet ? BANK[cluster].setA : BANK[cluster].setB).filter(
    (i) => !i.requiresLicense
  );
  let backupIndex = 0;
  return pool.map((idea) => {
    if (idea.requiresLicense && !hasLicense) {
      const replacement = backup[backupIndex % backup.length];
      backupIndex += 1;
      return replacement;
    }
    return idea;
  });
}

export function generateRuledOut(
  cluster: Cluster,
  hasLicense: boolean,
  lang: Lang = "en"
): { title: string; reason: string }[] {
  if (hasLicense) return [];
  const BANK = lang === "es" ? IDEA_BANK_ES : IDEA_BANK;
  const allIdeas = [...BANK[cluster].setA, ...BANK[cluster].setB];
  const licensed = allIdeas.filter((i) => i.requiresLicense);
  const seen = new Set<string>();
  const ruledOut: { title: string; reason: string }[] = [];
  for (const idea of licensed) {
    if (seen.has(idea.title)) continue;
    seen.add(idea.title);
    ruledOut.push({
      title: idea.title,
      reason:
        lang === "es"
          ? "Este tipo de trabajo necesita una licencia que todavía no mencionaste tener; no vale la pena el riesgo hasta tenerla."
          : "This scope of work needs a license you haven't mentioned having yet — the liability isn't worth the risk until that's in place.",
    });
  }
  return ruledOut.slice(0, 2);
}

export function generateAnalysis(answers: DiscoveryAnswers, lang: Lang = "en") {
  if (lang === "es") return generateAnalysisEs(answers);
  const { location, background, license, capacity } = answers;
  const cluster = detectCluster(background);
  const ownTools = hasOwnToolsSignal(capacity);
  const informalDemand = hasInformalDemandSignal(background);
  const place = location.trim() ? location.trim() : "where you are";

  const demandByCluster: Record<Cluster, string> = {
    construction: "steady, year-round demand for hands-on home repair and small building work — the kind that doesn't dry up when a season ends",
    cleaning: "consistent demand for reliable home and business cleaning, especially recurring, scheduled work",
    landscaping: "seasonal but reliable demand for yard and outdoor upkeep that most homeowners don't want to do themselves",
    general: "ongoing demand for dependable local help with the everyday tasks people don't have time for",
  };

  const localDemand = `In ${place}, there's ${demandByCluster[cluster]}.`;

  const yourFit = informalDemand
    ? `You mentioned people already come to you for this kind of help — that's a live signal of real, paying demand, not just a hunch. Combined with what you described (${background.trim().replace(/\.$/, "")}), that's a strong starting point.`
    : `Based on what you described (${background.trim().replace(/\.$/, "")}), you already have relevant hands-on experience to build on.`;

  const startupCost = ownTools
    ? "You already have the tools and equipment this kind of work needs — that's usually the biggest upfront cost, so you're starting with a higher margin than most."
    : "You'll likely need to budget for some basic tools or equipment before the first paid job — many people start small and reinvest as bookings come in.";

  const hasLicense = hasLicenseSignal(license);

  return {
    cluster,
    hasLicense,
    localDemand,
    yourFit,
    startupCost,
    ruledOut: generateRuledOut(cluster, hasLicense),
  };
}

function generateAnalysisEs(answers: DiscoveryAnswers) {
  const { location, background, license, capacity } = answers;
  const cluster = detectCluster(background);
  const ownTools = hasOwnToolsSignal(capacity);
  const informalDemand = hasInformalDemandSignal(background);
  const place = location.trim() ? location.trim() : "tu zona";

  const demandByCluster: Record<Cluster, string> = {
    construction: "una demanda constante, todo el año, de arreglos del hogar y obras pequeñas, del tipo que no se acaba cuando cambia la temporada",
    cleaning: "una demanda constante de limpieza confiable de hogares y negocios, sobre todo de trabajos recurrentes con horario fijo",
    landscaping: "una demanda de temporada, pero confiable, de mantenimiento de jardines y exteriores que la mayoría de dueños de casa no quiere hacer",
    general: "una demanda continua de ayuda local confiable con las tareas del día a día para las que la gente no tiene tiempo",
  };

  const localDemand = `En ${place} hay ${demandByCluster[cluster]}.`;
  const bg = background.trim().replace(/\.$/, "");

  const yourFit = informalDemand
    ? `Mencionaste que la gente ya te busca para este tipo de ayuda: esa es una señal real de demanda pagada, no solo una corazonada. Sumado a lo que contaste (${bg}), es un punto de partida sólido.`
    : `Por lo que contaste (${bg}), ya tienes experiencia práctica en la que apoyarte.`;

  const startupCost = ownTools
    ? "Ya tienes las herramientas y el equipo que este trabajo necesita, que suele ser la mayor inversión inicial; arrancas con mejor margen que la mayoría."
    : "Probablemente necesites presupuestar algunas herramientas o equipo básico antes del primer trabajo pagado; mucha gente empieza con poco y reinvierte a medida que llegan clientes.";

  const hasLicense = hasLicenseSignal(license);

  return {
    cluster,
    hasLicense,
    localDemand,
    yourFit,
    startupCost,
    ruledOut: generateRuledOut(cluster, hasLicense, "es"),
  };
}

export function generateDiscoveryPitch(opts: {
  name: string;
  idea: Idea;
  location: string;
  pricing: string;
  lang?: Lang;
}): string {
  const where = opts.location.trim();
  const place = where ? (opts.lang === "es" ? `, atendiendo en ${where}` : ` serving ${where}`) : "";
  return `${opts.name}${place}. ${opts.idea.desc} ${opts.pricing.trim()}.`.replace(/\s+/g, " ").trim();
}
