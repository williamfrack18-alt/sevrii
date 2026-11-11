// Projects that answered the old interview cards (before the Brain became a
// chat): their answers become profile facts, so the chat never asks them
// again. Pure: the US city lookup is passed in (lib/geo is server-only).
import { isOnlinePlace, type CardAnswers } from "../cards";
import type { BusinessPlan } from "../plan";
import { countryNamedIn, countryOfPlace } from "./place";

// The cards as profile facts the research and the Strategist already read.
// Only what the person wrote: a "no sé" stays unknown, never a guess.
export function cardsToProfile(plan: BusinessPlan, cards: CardAnswers, lookupPlace: (raw: string) => { city: string; state: string } | null = () => null): BusinessPlan["profile"] {
  const said = (id: string) => (cards[id] && !cards[id].u ? cards[id].v.trim() : "");
  const num = (re: RegExp, text: string) => {
    const m = re.exec(text);
    return m ? Number(m[1].replace(/,/g, "")) : null;
  };
  const place = (raw: string): { city: string; state: string; country?: string; region?: string } | null => {
    if (!raw.trim() || isOnlinePlace(raw)) return null;
    // Any country: "Madrid, España" or "Medellín" is not Madrid, Iowa. Only a
    // place with no sign of another country goes to the US city list.
    const country = countryOfPlace(raw);
    if (country && country !== "US") {
      const parts = raw.split(",").map((x) => x.trim()).filter(Boolean);
      const last = parts[parts.length - 1] ?? "";
      const named = countryNamedIn(last) || (last.toUpperCase() === country ? country : "");
      const rest = named && parts.length > 1 ? parts.slice(0, -1) : parts;
      return { city: (rest[0] ?? raw.trim()).slice(0, 80), state: "", country, region: rest.slice(1).join(", ").slice(0, 60) };
    }
    const hit = lookupPlace(raw);
    if (hit) return hit;
    // A place our list doesn't know (a small town, a typo) is still where they
    // work: kept as they wrote it, so the research isn't left without a city.
    const parts = raw.split(",").map((x) => x.trim()).filter(Boolean);
    const st = /^[A-Za-z]{2}$/.test(parts[parts.length - 1] ?? "") && parts.length > 1 ? parts[parts.length - 1].toUpperCase() : "";
    return { city: (st ? parts.slice(0, -1).join(", ") : raw.trim()).slice(0, 80), state: st };
  };
  const p = { ...plan.profile };
  if (plan.mode === "new") {
    const d = cards.delivery;
    p.likes = [said("talent"), said("likes")].filter(Boolean).join("; ");
    p.workHistory = cards.experience?.u ? "ninguna" : said("experience");
    p.notWant = cards.notWant?.u ? "nada en especial" : said("notWant");
    p.tools = cards.resources?.u ? "nada de eso" : said("resources");
    p.hoursPerWeek = num(/(\d{1,3})\s*(?:h\b|hrs?|horas|hours)/i, said("time"));
    p.startBudgetUsd = num(/\$\s?(\d{1,3}(?:,\d{3})+|\d+)/, said("resources"));
    p.incomeGoal = said("income");
    p.direction = "open";
    if (d && !d.u) {
      p.workPlace = d.c === "digital" ? "home" : d.c === "fisico" ? "out" : "any";
      // Only digital decides it now; otherwise the chosen idea does (an
      // earlier "digital" answer never sticks once it was changed).
      p.serviceMode = d.c === "digital" ? "remote" : "";
      const where = place(d.p);
      if (where) Object.assign(p, { city: where.city, state: where.state, ...(where.country ? { country: where.country, region: where.region ?? "" } : {}) });
    } else p.workPlace = "any";
  } else {
    const s = cards.service;
    p.mainService = said("service");
    if (s && isOnlinePlace(s.p)) p.serviceMode = "remote";
    else {
      const where = s ? place(s.p) : null;
      if (where) Object.assign(p, { city: where.city, state: where.state, ...(where.country ? { country: where.country, region: where.region ?? "" } : {}) });
      // A city means in person (an earlier "en línea" answer doesn't stick).
      p.serviceMode = "local";
    }
    p.currentPrice = said("prices");
    p.costs = said("costs");
    // "$8 de materiales", "$8 en material", "$8 of materials".
    p.costMaterialsUsd = num(/\$\s?(\d+)\s*(?:de|en|of|in)?\s*materia(?:l|les|ls)\b/i, said("costs"));
    p.hoursPerWeek = num(/(\d{1,3})\s*(?:h\b|hrs?|horas|hours)\s*(?:a la|por|per|a)\s*(?:semana|week)/i, said("hours"));
    p.costHoursPerJob = num(/(\d{1,2}(?:\.\d)?)\s*(?:h\b|hrs?|horas?|hours?)\s*(?:por|per|each|cada)\s*(?:trabajo|par|cliente|visita|job|pair|client|visit)/i, said("hours"));
    p.typicalCustomer = cards.clients?.u ? "todavía no tiene clientes" : said("clients");
    // "Todavía no tengo" on that card already answers how clients find them.
    p.howGetsClients = cards.clients?.u ? "todavía no tiene clientes" : said("clients");
    p.tools = said("assets");
    const g = cards.goal;
    const goals: Record<string, string> = { clients: "más clientes", price: "cobrar mejor", hours: "trabajar más horas", new: "ofrecer algo nuevo" };
    p.ownerGoal = g && !g.u ? [goals[g.c] ?? "", g.v].filter(Boolean).join(": ") : "";
  }
  return p;
}

