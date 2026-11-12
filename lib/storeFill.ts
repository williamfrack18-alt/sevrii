// Writes an approved Brain expediente into the store page (see planToStore.ts).
import { addChatMessage, addService, deleteService, getBusinessById, listServices, mergeBusinessSite, setServiceAgent, updateBusinessDetails, type BusinessRow } from "./db";
import { EMPTY_AGENT, offerTarget, parseServiceAgent, periodHours, type AgentOffer, type ServiceAgent } from "./serviceAgentConfig";
import type { BusinessPlan } from "./plan";
import { isPlaceholderName, normalizePhone, type SiteData } from "./site";
import { planFingerprint, planReadyForStore, storeFromPlan } from "./planToStore";
import { stripReasoning } from "./pageText";

type Lang = "es" | "en";

export type FillResult = { filled: boolean; business?: BusinessRow };

// onlyIfEmpty: used right after the expediente is approved. It never touches a
// page the owner already started; the Store tab offers the update instead.
// quiet: the caller writes its own chat message (choosing how to start).
export async function fillStoreFromPlan(businessId: string, lang: Lang, opts: { onlyIfEmpty?: boolean; quiet?: boolean } = {}): Promise<FillResult> {
  const b = await getBusinessById(businessId);
  if (!b || !planReadyForStore(b.plan)) return { filled: false };
  // C: the agent the strategy proposed becomes the first draft of the agent
  // in Store (only while the owner hasn't started one).
  if (b.plan.mode === "agent" && !b.serviceAgent.name && b.plan.agent) await setServiceAgent(b.id, agentFromPlan(b.plan));
  const services = await listServices(b.id);
  if (opts.onlyIfEmpty && (services.length > 0 || b.site.headline)) return { filled: false };

  const draft = storeFromPlan(b.plan, lang);
  const d = draft.site;
  const cur = b.site;
  // Lists and texts from the plan replace the old ones; facts the plan doesn't
  // know (unknown = empty) never erase what the owner already said.
  const site: SiteData = {
    ...cur,
    headline: d.headline || cur.headline,
    serviceArea: d.serviceArea || cur.serviceArea,
    licenseState: d.licenseState || cur.licenseState,
    noLicenseNeeded: d.noLicenseNeeded || cur.noLicenseNeeded,
    insured: d.insured || cur.insured,
    spanish: d.spanish || cur.spanish,
    langs: d.langs || cur.langs,
    // The name they gave the Brain: Store doesn't ask it again.
    ownerName: cur.ownerName || d.ownerName,
    yearsInBusiness: d.yearsInBusiness ?? (b.plan.profile.yearsOwnBusiness === 0 ? null : cur.yearsInBusiness),
    keyPoints: d.keyPoints.length ? d.keyPoints : cur.keyPoints,
    steps: d.steps.length ? d.steps : cur.steps,
    faq: d.faq.length ? d.faq : cur.faq,
    offer: b.plan.noOffer ? null : d.offer ?? cur.offer,
    ctaTitle: d.ctaTitle || cur.ctaTitle,
    ctaText: d.ctaText || cur.ctaText,
    lang: d.lang,
    fromPlan: planFingerprint(b.plan),
  };
  // Where they work, from the Brain profile (only if the page doesn't say yet).
  // The place finder only knows US cities ("Madrid" would land in Madrid, Iowa;
  // "Toronto" in Ohio): outside the US the page keeps the city as they said it.
  const abroad = Boolean(b.plan.profile.country) && b.plan.profile.country !== "US";
  if (!cur.reachMode && abroad) {
    const p = b.plan.profile;
    if (p.serviceMode === "remote") Object.assign(site, { reachMode: "remote", reachScope: p.remoteScope === "world" ? "world" : "us", baseState: "" });
    else if (p.city) Object.assign(site, { reachMode: "local", reachRadius: p.radiusMiles || 25, baseCity: p.city.slice(0, 60), baseState: "", baseLat: null, baseLon: null, baseZip: "" });
  }
  else if (!cur.reachMode) {
    const p = b.plan.profile;
    if (p.serviceMode === "remote") {
      const { stateCode } = await import("./geo");
      const st = stateCode(p.state || "");
      Object.assign(site, { reachMode: "remote", reachScope: p.remoteScope === "world" ? "world" : p.remoteScope === "state" && st ? "state" : "us", ...(st ? { baseState: st } : {}) });
    }
    else if (p.city || p.zip) {
      const { lookupPlace } = await import("./geo");
      // The ZIP places them precisely; the city is the fallback.
      const where = (p.zip ? lookupPlace(p.zip) : null) ?? lookupPlace(`${p.city}${p.state ? `, ${p.state}` : ""}`);
      if (where) Object.assign(site, { reachMode: "local", reachRadius: p.radiusMiles || 25, baseCity: where.city, baseState: where.state, baseLat: where.lat, baseLon: where.lon, baseZip: p.zip || "" });
    }
  }
  else if (!abroad && cur.reachMode === "local" && b.plan.profile.zip && !cur.baseZip) {
    const { lookupPlace } = await import("./geo");
    const where = lookupPlace(b.plan.profile.zip);
    if (where) Object.assign(site, { baseZip: b.plan.profile.zip, baseCity: where.city, baseState: where.state, baseLat: where.lat, baseLon: where.lon });
  }
  // Never write the photo/video fields: an upload may be happening right now.
  const { coverUrl: _c, logoUrl: _l, gallery: _g, videoUrl: _v, ...text } = site;
  void _c; void _l; void _g; void _v;
  await mergeBusinessSite(b.id, cur, text);

  const det = draft.details;
  await updateBusinessDetails(b.id, {
    // The business type the owner already has stays (the plan's service title is
    // long, e.g. "Limpieza de casas… (estándar y profunda)"); only fill it if empty.
    ...(det.category && !b.category?.trim() ? { category: det.category } : {}),
    ...(det.city ? { city: det.city } : {}),
    ...(det.pitch ? { pitch: det.pitch } : {}),
  });

  if (draft.services.length) {
    // A package the plan still shows as a market reference has no price here;
    // the price the owner already gave it in Store is theirs and stays.
    const key = (x: string) => x.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
    const ownPrice = new Map(services.filter((s) => (s.price ?? "").trim()).map((s) => [key(s.name), s.price as string]));
    for (const s of services) await deleteService(s.id);
    let i = 0;
    for (const s of draft.services) await addService(b.id, s.name, s.price || ownPrice.get(key(s.name)) || "", s.description, i++);
  }

  const fresh = (await getBusinessById(b.id))!;
  const priced = (await listServices(b.id)).filter((s) => (s.price ?? "").trim()).length;
  if (!opts.quiet) await addChatMessage(b.id, "store", "ai", doneMessage(lang, fresh, draft.services.length, priced));
  return { filled: true, business: fresh };
}

export function doneMessage(lang: Lang, b: BusinessRow, packages: number, priced: number): string {
  const es = lang === "es";
  if (b.plan.mode === "agent" && b.serviceAgent.name) {
    return es
      ? `¡Listo! Armé tu agente, "${b.serviceAgent.name}", y su página con lo que aprobamos: sus pasos, sus límites, ${packages ? `tus ${packages} precios` : "sus precios"} y lo que verifiqué en fuentes oficiales, que es lo que ya sabe. Pruébalo en tu página («Ver mi página») antes de activarlo. Si quieres que sepa algo más, pégamelo aquí.`
      : `Done! I built your agent, "${b.serviceAgent.name}", and its page from what we approved: its steps, its limits, ${packages ? `your ${packages} prices` : "its prices"} and what I verified in official sources, which is what it already knows. Try it on your page before switching it on. If you want it to know more, paste it here.`;
  }
  const s = b.site;
  const missing: string[] = [];
  if (!s.chat && !s.phone && !normalizePhone(b.whatsapp)) missing.push(es ? "un teléfono de contacto" : "a contact phone");
  if (s.gallery.length === 0 && !s.coverUrl) missing.push(es ? "fotos de tus trabajos" : "photos of your work");
  if (!s.hours) missing.push(es ? "tu horario" : "your hours");
  if (!s.videoUrl) missing.push(es ? "un video corto tuyo" : "a short video of you");
  // Packages with a market reference go on the page without a price: never
  // call them "priced", and say the owner's own price is still needed.
  const unpriced = packages - priced;
  const pk = !packages
    ? ""
    : es
      ? ` y tus ${packages} paquetes${unpriced === 0 ? " con precio" : priced ? ` (${unpriced} todavía sin precio)` : " (todavía sin precio)"}`
      : ` and your ${packages} packages${unpriced === 0 ? " with prices" : priced ? ` (${unpriced} still without a price)` : " (still without prices)"}`;
  // Only the parts the page really got (never "preguntas frecuentes" when the
  // strategy had none), in the owner's words, not the internal "expediente".
  const parts = [
    es ? "título" : "headline",
    s.keyPoints.length ? (es ? "puntos clave" : "key points") : "",
    s.steps.length ? (es ? "cómo trabajas" : "how you work") : "",
    s.faq.length ? (es ? "preguntas frecuentes" : "FAQ") : "",
  ].filter(Boolean);
  const partList = pk ? parts.join(", ") : parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} ${es ? "y" : "and"} ${parts[parts.length - 1]}`;
  // Parts the owner hid (or a page started blank) stay hidden after a rebuild.
  const hiddenNote = s.hidden.length
    ? es
      ? " Las partes que tienes ocultas siguen ocultas: pídeme mostrar la que quieras."
      : " The parts you hid stay hidden: ask me to show any of them."
    : "";
  const built = es
    ? `¡Listo! Armé tu página con lo que aprobaste en el Cerebro: ${partList}${pk}. A la derecha ves tu página tal como queda (en el teléfono, toca «Vista previa»).${hiddenNote}`
    : `Done! I built your page from what you approved in the Brain: ${partList}${pk}. On the right you see your page as it looks (on a phone, tap "Preview").${hiddenNote}`;
  if (packages && unpriced > 0) missing.unshift(es ? "tu precio para cada paquete que todavía no lo tiene" : "your price for each package that doesn't have one yet");
  if (!s.reachMode) missing.unshift(es ? "dónde atiendes (en persona en tu zona o en línea)" : "where you serve (in person in your area, or online)");
  // A new project is still called "Proyecto nuevo": the page needs its real name.
  if (isPlaceholderName(b.name)) missing.unshift(es ? "el nombre de tu negocio (o el tuyo, si trabajas con tu nombre)" : "your business name (or your own, if you work under your name)");
  const media = s.gallery.length === 0 && !s.coverUrl || !s.videoUrl;
  if (!missing.length) return `${built} ${es ? "Si quieres cambiar algo, dímelo aquí." : "If you want to change anything, tell me here."}`;
  const list = missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(", ")} ${es ? "y" : "and"} ${missing[missing.length - 1]}`;
  const how = media
    ? es ? "Las fotos y el video me los puedes mandar aquí mismo con el botón +." : "You can send me the photos and the video right here with the + button."
    : es ? "Dímelo aquí." : "Tell me here.";
  // "Me faltan fotos…", "me falta tu horario".
  const plural = missing.length > 1 || /^(fotos|photos)/i.test(missing[0]);
  return `${built} ${es ? `Para que quede completa me falta${plural ? "n" : ""} ${list}.` : `To finish it I still need ${list}.`} ${how}`;
}

// "$29/mes", "desde $15", "$40 por sesión de 3 días" → an offer the chat can sell.
function offerFromPackage(p: BusinessPlan["packages"][number], i: number): AgentOffer | null {
  const text = `${p.name} ${p.price} ${p.includes}`;
  const m = /\$\s?(\d{1,4}(?:[.,]\d{2})?)/.exec(p.price) || /\$\s?(\d{1,4}(?:[.,]\d{2})?)/.exec(text);
  if (!m) return null;
  const cents = Math.round(Number(m[1].replace(",", ".")) * 100);
  const monthly = /\b(mes|mensual|month|monthly)\b/i.test(text);
  const days = /(\d{1,3})\s*(d[ií]as?|days?)\b/i.exec(text);
  const hours = /(\d{1,3})\s*(horas?|hours?|hrs?)\b/i.exec(text);
  return parseServiceAgent({
    offers: [
      {
        id: `o${i + 1}`,
        title: p.name,
        detail: p.includes,
        priceCents: cents,
        billing: monthly ? "monthly" : "once",
        hours: periodHours(text) ?? (days ? Number(days[1]) * 24 : hours ? Number(hours[1]) : 24),
      },
    ],
  }).offers[0] ?? null;
}

function welcomeFromPlan(plan: BusinessPlan): { welcomePercent: number; welcomeOn: "all" | "once" | "monthly"; welcomeOffer: string } | Record<string, never> {
  const o = plan.offer;
  if (!o || plan.noOffer) return {};
  const m = /(\d{1,2})\s*%/.exec(`${o.label} ${o.detail}`);
  if (!m) return {};
  const text = `${o.label} ${o.detail}`;
  const on = /\b(mes|mensual|month|monthly)\b/i.test(text) ? "monthly" : "all";
  const welcomeOffer = offerTarget(text, plan.packages.map((p, i) => ({ id: `o${i + 1}`, name: p.name })));
  return { welcomePercent: Number(m[1]), welcomeOn: on, welcomeOffer };
}

// What the research verified (official steps with their links, customers'
// usual questions): the agent's starting knowledge, so it guides without
// inventing. The creator can add more from Store.
function knowledgeFromMarket(plan: BusinessPlan): string {
  const m = plan.market;
  const steps = m.requirements.filter((r) => r.item && r.applies !== "no");
  const parts = [
    steps.length
      ? `Pasos y requisitos verificados (dilos con su enlace; si algo dice "verificar", pide al cliente confirmarlo en la página oficial):\n${steps
          .map((r) => `- ${r.item}${r.note ? `: ${r.note}` : ""}${r.link ? ` (${r.link})` : ""}${r.applies === "check" ? " [verificar]" : ""}`)
          .join("\n")}`
      : "",
    m.faq.length ? `Preguntas frecuentes de los clientes:\n${m.faq.map((f) => `- ${f.q} ${f.a}`).join("\n")}` : "",
    m.prices ? `Lo que cobran otros por esto: ${[m.prices.low, m.prices.mid, m.prices.high].filter(Boolean).join(" / ")}` : "",
  ].filter(Boolean);
  return parts.join("\n\n").slice(0, 20000);
}

export function agentFromPlan(plan: BusinessPlan): ServiceAgent {
  const a = plan.agent;
  const p = plan.profile;
  const steps = a?.steps.length ? a.steps : plan.steps;
  const instructions = [
    plan.service ? `Servicio: ${plan.service}.` : "",
    plan.customer ? `Clientes: ${plan.customer}.` : "",
    p.agentTask ? `Qué haces con cada cliente: ${p.agentTask}` : "",
    steps.length ? `Pasos:\n${steps.map((x, i) => `${i + 1}. ${x}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  return parseServiceAgent({
    ...EMPTY_AGENT,
    // Name, role and offers show on the customer's page: no internal reasoning.
    name: stripReasoning(a?.name || plan.service),
    role: stripReasoning(a?.role || plan.serviceIncludes),
    instructions,
    knowledge: [p.agentKnowledge, knowledgeFromMarket(plan)].filter(Boolean).join("\n\n"),
    limits: a?.limits.length ? a.limits : p.agentLimits ? [p.agentLimits] : [],
    greeting: a?.greeting || "",
    creator: a?.creator || "",
    edge: (a?.edge ?? []).map((e) => ({ ...e, text: stripReasoning(e.text) })).filter((e) => e.title || e.text),
    // What it does end to end, as the strategy defined it.
    task: a?.task,
    // A market reference (ref) is not the owner's price: no one is charged it.
    offers: plan.packages
      .filter((k) => !k.ref)
      .map((k) => ({ ...k, name: stripReasoning(k.name), includes: stripReasoning(k.includes) }))
      .map(offerFromPackage)
      .filter(Boolean),
    // The welcome offer the strategy proposed ("15% off your first month").
    ...welcomeFromPlan({ ...plan, packages: plan.packages.filter((k) => !k.ref) }),
  });
}
