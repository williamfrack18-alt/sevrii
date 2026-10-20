// Writes an approved Brain expediente into the store page (see planToStore.ts).
import { addChatMessage, addService, deleteService, getBusinessById, listServices, mergeBusinessSite, setServiceAgent, updateBusinessDetails, type BusinessRow } from "./db";
import { EMPTY_AGENT, parseServiceAgent, type AgentOffer, type ServiceAgent } from "./serviceAgentConfig";
import type { BusinessPlan } from "./plan";
import { normalizePhone, type SiteData } from "./site";
import { planFingerprint, planReadyForStore, storeFromPlan } from "./planToStore";

type Lang = "es" | "en";

export type FillResult = { filled: boolean; business?: BusinessRow };

// onlyIfEmpty: used right after the expediente is approved. It never touches a
// page the owner already started; the Store tab offers the update instead.
export async function fillStoreFromPlan(businessId: string, lang: Lang, opts: { onlyIfEmpty?: boolean } = {}): Promise<FillResult> {
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
    yearsInBusiness: d.yearsInBusiness ?? cur.yearsInBusiness,
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
  if (!cur.reachMode) {
    const p = b.plan.profile;
    if (p.serviceMode === "remote") {
      const { stateCode } = await import("./geo");
      const st = stateCode(p.state || "");
      Object.assign(site, { reachMode: "remote", reachScope: p.remoteScope === "world" ? "world" : p.remoteScope === "state" && st ? "state" : "us", ...(st ? { baseState: st } : {}) });
    }
    else if (p.city) {
      const { lookupPlace } = await import("./geo");
      const where = lookupPlace(`${p.city}${p.state ? `, ${p.state}` : ""}`);
      if (where) Object.assign(site, { reachMode: "local", reachRadius: p.radiusMiles || 25, baseCity: where.city, baseState: where.state, baseLat: where.lat, baseLon: where.lon });
    }
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
    for (const s of services) await deleteService(s.id);
    let i = 0;
    for (const s of draft.services) await addService(b.id, s.name, s.price, s.description, i++);
  }

  const fresh = (await getBusinessById(b.id))!;
  await addChatMessage(b.id, "store", "ai", doneMessage(lang, fresh, draft.services.length));
  return { filled: true, business: fresh };
}

function doneMessage(lang: Lang, b: BusinessRow, packages: number): string {
  const es = lang === "es";
  const s = b.site;
  const missing: string[] = [];
  if (!s.chat && !s.phone && !normalizePhone(b.whatsapp)) missing.push(es ? "un teléfono de contacto" : "a contact phone");
  if (s.gallery.length === 0 && !s.coverUrl) missing.push(es ? "fotos de tus trabajos" : "photos of your work");
  if (!s.hours) missing.push(es ? "tu horario" : "your hours");
  if (!s.videoUrl) missing.push(es ? "un video corto tuyo" : "a short video of you");
  const built = es
    ? `¡Listo! Armé tu página con tu expediente: título, puntos clave, cómo trabajas, preguntas frecuentes${packages ? ` y tus ${packages} paquetes con precio` : ""}. Mírala aquí abajo.`
    : `Done! I built your page from your expediente: headline, key points, how you work, FAQ${packages ? ` and your ${packages} priced packages` : ""}. See it below.`;
  if (!s.reachMode) missing.unshift(es ? "dónde atiendes (en persona en tu zona o en línea)" : "where you serve (in person in your area, or online)");
  const media = s.gallery.length === 0 && !s.coverUrl || !s.videoUrl;
  if (!missing.length) return `${built} ${es ? "Si quieres cambiar algo, dímelo aquí." : "If you want to change anything, tell me here."}`;
  const list = missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(", ")} ${es ? "y" : "and"} ${missing[missing.length - 1]}`;
  const how = media
    ? es ? "Las fotos y el video me los puedes mandar aquí mismo con el botón +." : "You can send me the photos and the video right here with the + button."
    : es ? "Dímelo aquí." : "Tell me here.";
  return `${built} ${es ? `Para que quede completa me falta ${list}.` : `To finish it I still need ${list}.`} ${how}`;
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
        hours: days ? Number(days[1]) * 24 : hours ? Number(hours[1]) : 24,
      },
    ],
  }).offers[0] ?? null;
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
    name: a?.name || plan.service,
    role: a?.role || plan.serviceIncludes,
    instructions,
    knowledge: p.agentKnowledge,
    limits: a?.limits.length ? a.limits : p.agentLimits ? [p.agentLimits] : [],
    greeting: a?.greeting || "",
    offers: plan.packages.map(offerFromPackage).filter(Boolean),
  });
}
