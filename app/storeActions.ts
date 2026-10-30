"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { del, head, put } from "@vercel/blob";
import { getCurrentUser } from "@/lib/session";
import {
  addService,
  deleteService,
  getBusinessById,
  listServices,
  updateBusinessAccent,
  updateBusinessDetails,
  updateBusinessWhatsapp,
  appendGalleryPhoto,
  patchBusinessSite,
  mergeBusinessSite,
  updateService,
  type BusinessRow,
  type ServiceRow,
} from "@/lib/db";
import { isOurBlob, ownsBlob, LIMITS, normalizePhone, publishGaps, type PublishGap, type SiteData } from "@/lib/site";
import { allow, LIMITS as RATE } from "@/lib/guard";
import { addChatMessage, listChatMessages } from "@/lib/db";
import { agentAreaGreeting, runStoreChatTurn, storeGreeting } from "@/lib/storeAgent";
import { limitsFor, limitsForUserId } from "@/lib/billing";
import { publishBusiness } from "@/lib/marketplace";
import { chatGate, countAiUnit, gateMessage, runForUser } from "@/lib/usage";
import { getLang } from "@/lib/lang";
import { getDict } from "@/lib/i18n";
import { fillStoreFromPlan } from "@/lib/storeFill";

async function requireBusiness(): Promise<BusinessRow> {
  const user = await getCurrentUser();
  if (!user || !user.business) redirect("/login");
  return user.business;
}

function clip(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function refresh(slug: string) {
  revalidatePath("/dashboard");
  revalidatePath(`/site/${slug}`);
}

export type StoreFormInput = {
  name: string;
  headline: string;
  pitch: string;
  category: string;
  city: string;
  serviceArea: string;
  hours: string;
  phone: string;
  textEnabled: boolean;
  whatsapp: string;
  licenseNumber: string;
  licenseState: string;
  noLicenseNeeded: boolean;
  insured: boolean;
  spanish: boolean;
  yearsInBusiness: string;
  googleReviewsUrl: string;
  highlights: string[];
  faq: { q: string; a: string }[];
  accentColor: string;
  lang: "es" | "en";
};

export type StoreSaveResult =
  | { ok: true; business: BusinessRow; services: ServiceRow[] }
  | { ok: false; error: "phone" | "whatsapp" | "name" | "rate" };

export async function saveStoreAction(input: StoreFormInput): Promise<StoreSaveResult> {
  const business = await requireBusiness();
  if (!(await allow(`store-save:${business.id}`, 60, 60 * 10))) return { ok: false, error: "rate" };

  const name = clip(input.name, LIMITS.name);
  if (!name) return { ok: false, error: "name" };

  const phoneRaw = clip(input.phone, 30);
  const phone = phoneRaw ? normalizePhone(phoneRaw) : "";
  if (phoneRaw && !phone) return { ok: false, error: "phone" };

  const waRaw = clip(input.whatsapp, 30);
  const wa = waRaw ? normalizePhone(waRaw) : "";
  if (waRaw && !wa) return { ok: false, error: "whatsapp" };

  // Only the fields this form edits are written, so photos or a video that
  // finished uploading meanwhile are never erased by this save.
  const formPatch: Partial<SiteData> = {
    headline: input.headline,
    phone: phone || "",
    textEnabled: input.textEnabled,
    serviceArea: input.serviceArea,
    hours: input.hours,
    licenseNumber: input.licenseNumber,
    licenseState: input.licenseState,
    noLicenseNeeded: input.noLicenseNeeded,
    insured: input.insured,
    spanish: input.spanish,
    yearsInBusiness: input.yearsInBusiness,
    googleReviewsUrl: input.googleReviewsUrl,
    highlights: input.highlights,
    faq: input.faq,
    lang: input.lang,
  } as unknown as Partial<SiteData>;

  await updateBusinessDetails(business.id, {
    name,
    pitch: clip(input.pitch, LIMITS.pitch) || business.pitch,
    category: clip(input.category, 60) || business.category,
    city: clip(input.city, 80) || null,
  });
  await updateBusinessWhatsapp(business.id, wa || "");
  if (/^#[0-9a-fA-F]{6}$/.test(input.accentColor)) await updateBusinessAccent(business.id, input.accentColor);
  await mergeBusinessSite(business.id, business.site, formPatch);

  const fresh = (await getBusinessById(business.id))!;
  refresh(fresh.slug);
  return { ok: true, business: fresh, services: await listServices(business.id) };
}

export async function saveServiceAction(input: {
  id?: string;
  name: string;
  price: string;
  description: string;
}): Promise<ServiceRow[]> {
  const business = await requireBusiness();
  const name = clip(input.name, LIMITS.serviceName);
  const price = clip(input.price, LIMITS.servicePrice) || null;
  const description = clip(input.description, LIMITS.serviceDescription) || null;
  const current = await listServices(business.id);
  if (input.id) {
    // Ownership: the service must belong to this business.
    if (!current.some((s) => s.id === input.id)) return current;
    if (!name) return current;
    await updateService(input.id, { name, price, description });
  } else {
    if (!name || current.length >= 30) return current;
    await addService(business.id, name, price ?? undefined, description ?? undefined, current.length);
  }
  refresh(business.slug);
  return listServices(business.id);
}

export async function deleteServiceAction(id: string): Promise<ServiceRow[]> {
  const business = await requireBusiness();
  const current = await listServices(business.id);
  if (current.some((s) => s.id === id)) await deleteService(id);
  refresh(business.slug);
  return listServices(business.id);
}

export async function setPublishedAction(
  publish: boolean
): Promise<{ ok: boolean; gaps: PublishGap[]; business: BusinessRow; upgrade?: "starter" }> {
  const business = await requireBusiness();
  const user = await getCurrentUser();
  if (publish && user && !limitsFor(user).canPublish) return { ok: false, gaps: [], business, upgrade: "starter" };
  const services = await listServices(business.id);
  const gaps = publishGaps({
    category: business.category,
    whatsapp: business.whatsapp,
    site: business.site,
    serviceCount: services.length,
  });
  if (publish && gaps.length > 0) return { ok: false, gaps, business };
  const fresh = await runForUser(business.userId, () => publishBusiness(business.id, publish), "publish");
  refresh(fresh.slug);
  return { ok: true, gaps: [], business: fresh };
}

const IMAGE_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export type UploadResult =
  | { ok: true; business: BusinessRow }
  | { ok: false; error: "unavailable" | "tooBig" | "badType" | "failed" | "galleryFull" | "rate" };

export async function uploadStoreImageAction(formData: FormData): Promise<UploadResult> {
  const business = await requireBusiness();
  if (!process.env.BLOB_READ_WRITE_TOKEN) return { ok: false, error: "unavailable" };
  if (!(await allow(`upload:${business.id}`, 30, 60 * 60))) return { ok: false, error: "rate" };

  const kind = String(formData.get("kind") || "");
  const file = formData.get("file");
  if (!(file instanceof File) || !["logo", "cover", "gallery"].includes(kind)) return { ok: false, error: "failed" };
  const ext = IMAGE_TYPES[file.type];
  if (!ext) return { ok: false, error: "badType" };
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, error: "tooBig" };
  if (kind === "gallery" && business.site.gallery.length >= LIMITS.gallery) return { ok: false, error: "galleryFull" };

  try {
    const blob = await put(`stores/${business.id}/${kind}-${Date.now()}.${ext}`, file, {
      access: "public",
      contentType: file.type,
      addRandomSuffix: true,
    });
    if (kind === "logo") {
      await patchBusinessSite(business.id, { logoUrl: blob.url });
      if (business.site.logoUrl) await dropBlob(business.site.logoUrl, business.id);
    } else if (kind === "cover") {
      await patchBusinessSite(business.id, { coverUrl: blob.url });
      // The old main photo stays on the page, in the gallery.
      const old = business.site.coverUrl;
      if (old && !(await appendGalleryPhoto(business.id, old, LIMITS.gallery))) await dropBlob(old, business.id);
    } else if (!(await appendGalleryPhoto(business.id, blob.url, LIMITS.gallery))) {
      await dropBlob(blob.url, business.id);
      return { ok: false, error: "galleryFull" };
    }
  } catch (err) {
    console.error("[store] upload failed", err);
    return { ok: false, error: "failed" };
  }
  const fresh = (await getBusinessById(business.id))!;
  refresh(fresh.slug);
  return { ok: true, business: fresh };
}

// Deletes a file, but only one inside this business's own folder.
async function dropBlob(url: string, businessId: string) {
  if (!url || !ownsBlob(url, businessId) || !process.env.BLOB_READ_WRITE_TOKEN) return;
  // Never delete a file the page still shows somewhere (e.g. it's also the owner's photo).
  const s = (await getBusinessById(businessId))?.site;
  if (s && [s.logoUrl, s.ownerPhotoUrl, s.coverUrl, s.videoUrl, ...s.gallery].includes(url)) return;
  try {
    await del(url);
  } catch {
    // The page no longer uses it; a leftover file is harmless.
  }
}

// The browser uploads the video straight to storage (app/api/upload); this
// saves it on the page. Only videos in this project's own folder are accepted.
export async function setStoreVideoAction(url: string): Promise<{ ok: boolean; business: BusinessRow }> {
  const business = await requireBusiness();
  let path = "";
  try {
    path = new URL(url).pathname;
  } catch {
    return { ok: false, business };
  }
  if (!isOurBlob(url) || !path.startsWith(`/stores/${business.id}/video-`)) return { ok: false, business };
  // head() only finds files in Sevrii's own storage, and tells us it's a video.
  try {
    const info = await head(url);
    if (!info.contentType.startsWith("video/")) return { ok: false, business };
  } catch {
    return { ok: false, business };
  }
  const old = business.site.videoUrl;
  await patchBusinessSite(business.id, { videoUrl: url });
  if (old && old !== url) await dropBlob(old, business.id);
  const fresh = (await getBusinessById(business.id))!;
  refresh(fresh.slug);
  return { ok: true, business: fresh };
}

// ---------- Store chat (the whole Store tab is this conversation) ----------

export type StoreChatResponse = {
  messages: { id: string; role: string; content: string }[];
  business: BusinessRow;
  services: ServiceRow[];
};

// area "agent" = the Agente section of the panel: the same builder, its own
// conversation, focused on the agent (the sales page stays in Store).
export async function sendStoreChatAction(message: string, area: "store" | "agent" = "store"): Promise<StoreChatResponse> {
  const business = await requireBusiness();
  const lang = await getLang();
  const t = getDict(lang).dashboard;
  const text = String(message || "").trim();
  const channel = area === "agent" ? "agent" : "store";
  let history = await listChatMessages(business.id, channel);

  const respond = async (b: BusinessRow) => ({
    messages: (await listChatMessages(business.id, channel)).map((m) => ({ id: m.id, role: m.role, content: m.content })),
    business: b,
    services: await listServices(business.id),
  });

  if (!text) return respond(business);

  if (history.length === 0) {
    await addChatMessage(business.id, channel, "ai", channel === "agent" ? agentAreaGreeting(lang, business) : storeGreeting(lang, business, (await listServices(business.id)).length));
    history = await listChatMessages(business.id, channel);
  }

  let blocked: string | null = null;
  if (text.length > RATE.aiMaxChars) blocked = t.aiTooLong;
  else {
    const reason = await chatGate(business.userId);
    if (reason) blocked = gateMessage(reason, t);
  }
  if (blocked) {
    await addChatMessage(business.id, channel, "ai", blocked);
    return respond(business);
  }

  await addChatMessage(business.id, channel, "user", text);
  const canPublish = (await limitsForUserId(business.userId)).canPublish;
  await countAiUnit("store_chat");
  const result = await runForUser(business.userId, () => runStoreChatTurn({
    business,
    canPublish,
    reload: async () => (await getBusinessById(business.id))!,
    history: history.slice(-16).map((m) => ({
      role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
      content: m.content.slice(0, RATE.aiMaxChars),
    })),
    message: text.startsWith("📷 ")
      ? `${lang === "es" ? "Subí una foto" : "I uploaded a photo"}: ${text.slice(3).trim()}`
      : text.startsWith("🎥 ")
        ? lang === "es"
          ? "Subí mi video (ya quedó puesto en la página, primero en la galería)."
          : "I uploaded my video (it's already on the page, first in the gallery)."
        : text,
    lang,
    area: channel,
  }), "store_chat");
  await addChatMessage(business.id, channel, "ai", result.reply);
  refresh(result.business.slug);
  return respond(result.business);
}

// "Build my page from my expediente" in the Store tab.
export async function fillStoreFromPlanAction(): Promise<{
  ok: boolean;
  business: BusinessRow;
  services: ServiceRow[];
  messages: { id: string; role: string; content: string }[];
}> {
  const business = await requireBusiness();
  const lang = await getLang();
  const ok = (await allow(`fillplan:${business.id}`, 20, 60 * 60)) && (await fillStoreFromPlan(business.id, lang)).filled;
  const fresh = (await getBusinessById(business.id)) ?? business;
  if (ok) refresh(fresh.slug);
  return {
    ok,
    business: fresh,
    services: await listServices(business.id),
    messages: (await listChatMessages(business.id, "store")).map((m) => ({ id: m.id, role: m.role, content: m.content })),
  };
}

// The Store as it is now on the server (the Brain may have built the page and
// written its first message after this screen was loaded).
export async function loadStoreAction(): Promise<{
  business: BusinessRow;
  services: ServiceRow[];
  messages: { id: string; role: string; content: string }[];
}> {
  const business = await requireBusiness();
  return {
    business,
    services: await listServices(business.id),
    messages: (await listChatMessages(business.id, "store")).map((m) => ({ id: m.id, role: m.role, content: m.content })),
  };
}

// ---------- Service agent (the page chat delivers the service) ----------
export async function setAgentEnabledAction(on: boolean): Promise<{ ok: boolean; business: BusinessRow; missing: string[] }> {
  const business = await requireBusiness();
  const { agentMissing, parseServiceAgent, taskMissing } = await import("@/lib/serviceAgentConfig");
  const { setServiceAgent } = await import("@/lib/db");
  // Switching on needs the complete task it does end to end (no task, no agent).
  const missing = on ? [...agentMissing(business.serviceAgent), ...taskMissing(business.serviceAgent.task).map((x) => `task.${x}`)] : [];
  if (missing.length) return { ok: false, business, missing };
  await setServiceAgent(business.id, parseServiceAgent({ ...business.serviceAgent, enabled: on }));
  const fresh = (await getBusinessById(business.id))!;
  refresh(fresh.slug);
  return { ok: true, business: fresh, missing: [] };
}

export type AgentSales = { count: number; totalCents: number; active: number; recent: { title: string; amountCents: number; email: string | null; createdAt: string; billing: string }[] };

export async function agentSalesAction(): Promise<AgentSales> {
  const business = await requireBusiness();
  const { listAgentAccess } = await import("@/lib/db");
  const rows = await listAgentAccess(business.id, 100);
  const now = Date.now();
  return {
    count: rows.length,
    totalCents: rows.reduce((n, r) => n + r.amountCents, 0),
    active: rows.filter((r) => r.status === "active" && new Date(r.endsAt).getTime() > now).length,
    recent: rows.slice(0, 5).map((r) => ({ title: r.title, amountCents: r.amountCents, email: r.email, createdAt: r.createdAt, billing: r.billing })),
  };
}

// The link to show the draft page to someone before publishing (it only
// opens this page; chat, orders and payments switch on when it's published).
export async function previewLinkAction(): Promise<string> {
  const business = await requireBusiness();
  const { previewKey } = await import("@/lib/preview");
  const base = (process.env.SEVRII_SITE_URL || "https://www.sevrii.com").replace(/\/+$/, "");
  return `${base}/site/${business.slug}?vista=${previewKey(business.id)}`;
}
