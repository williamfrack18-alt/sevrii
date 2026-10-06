// Marketplace categories. Pure data, safe for client components.
// Sevrii's marketplace (sevrii.com): every published page appears there, in
// the category of its service. The category is chosen automatically when the
// owner publishes; the owner can't change it.
// The keys are the data-category values used by public/index.html and
// public/en/index.html — keep them identical.
export const MARKET_CATEGORIES = [
  "Finanzas y Crédito",
  "Mudanzas",
  "Hogar y Limpieza",
  "Belleza y Cuidado",
  "Reparaciones",
  "Legal y Trámites",
  "Eventos",
  "Tecnología",
  "Salud y Bienestar",
  "Educación",
  "Automotriz",
  "Mascotas",
  "Fotografía",
  "Asesoría y Negocios",
] as const;
export type MarketCategory = (typeof MARKET_CATEGORIES)[number];

export const MARKET_CATEGORY_EN: Record<MarketCategory, string> = {
  "Finanzas y Crédito": "Finance & Credit",
  Mudanzas: "Moving",
  "Hogar y Limpieza": "Home & Cleaning",
  "Belleza y Cuidado": "Beauty & Care",
  Reparaciones: "Repairs",
  "Legal y Trámites": "Legal & Paperwork",
  Eventos: "Events",
  Tecnología: "Technology",
  "Salud y Bienestar": "Health & Wellness",
  Educación: "Education",
  Automotriz: "Automotive",
  Mascotas: "Pets",
  Fotografía: "Photography",
  "Asesoría y Negocios": "Consulting & Business",
};

export function isMarketCategory(v: unknown): v is MarketCategory {
  return typeof v === "string" && (MARKET_CATEGORIES as readonly string[]).includes(v);
}
