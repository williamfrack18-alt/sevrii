// Writes an approved Brain expediente into the store page (see planToStore.ts).
import { addChatMessage, addService, deleteService, getBusinessById, listServices, updateBusinessDetails, updateBusinessSite, type BusinessRow } from "./db";
import { normalizePhone, type SiteData } from "./site";
import { planFingerprint, planReadyForStore, storeFromPlan } from "./planToStore";

type Lang = "es" | "en";

export type FillResult = { filled: boolean; business?: BusinessRow };

// onlyIfEmpty: used right after the expediente is approved. It never touches a
// page the owner already started; the Store tab offers the update instead.
export async function fillStoreFromPlan(businessId: string, lang: Lang, opts: { onlyIfEmpty?: boolean } = {}): Promise<FillResult> {
  const b = await getBusinessById(businessId);
  if (!b || !planReadyForStore(b.plan)) return { filled: false };
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
  await updateBusinessSite(b.id, site);

  const det = draft.details;
  await updateBusinessDetails(b.id, {
    ...(det.category ? { category: det.category } : {}),
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
  if (!s.phone && !normalizePhone(b.whatsapp)) missing.push(es ? "tu WhatsApp o teléfono" : "your WhatsApp or phone number");
  if (s.gallery.length === 0 && !s.coverUrl) missing.push(es ? "fotos de tus trabajos" : "photos of your work");
  if (!s.hours) missing.push(es ? "tu horario" : "your hours");
  const built = es
    ? `¡Listo! Armé tu página con tu expediente: título, puntos clave, cómo trabajas, preguntas frecuentes${packages ? ` y tus ${packages} paquetes con precio` : ""}. Mírala aquí abajo.`
    : `Done! I built your page from your expediente: headline, key points, how you work, FAQ${packages ? ` and your ${packages} priced packages` : ""}. See it below.`;
  if (!missing.length) return `${built} ${es ? "Si quieres cambiar algo, dímelo aquí." : "If you want to change anything, tell me here."}`;
  const list = missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(", ")} ${es ? "y" : "and"} ${missing[missing.length - 1]}`;
  return `${built} ${es ? `Para que quede completa me falta ${list}. Mándamelo aquí.` : `To finish it I still need ${list}. Send it to me here.`}`;
}
