"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { put } from "@vercel/blob";
import { getCurrentUser } from "@/lib/session";
import {
  addService,
  deleteService,
  getBusinessByUserId,
  listServices,
  setBusinessPublished,
  updateBusinessAccent,
  updateBusinessDetails,
  updateBusinessSite,
  updateBusinessWhatsapp,
  updateService,
  type BusinessRow,
  type ServiceRow,
} from "@/lib/db";
import { LIMITS, normalizePhone, parseSite, publishGaps, type PublishGap, type SiteData } from "@/lib/site";
import { allow } from "@/lib/guard";

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

  const site: SiteData = parseSite({
    ...business.site,
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
  });

  await updateBusinessDetails(business.id, {
    name,
    pitch: clip(input.pitch, LIMITS.pitch) || business.pitch,
    category: clip(input.category, 60) || business.category,
    city: clip(input.city, 80) || null,
  });
  await updateBusinessWhatsapp(business.id, wa || "");
  if (/^#[0-9a-fA-F]{6}$/.test(input.accentColor)) await updateBusinessAccent(business.id, input.accentColor);
  await updateBusinessSite(business.id, site);

  const fresh = (await getBusinessByUserId(business.userId))!;
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
): Promise<{ ok: boolean; gaps: PublishGap[]; business: BusinessRow }> {
  const business = await requireBusiness();
  const services = await listServices(business.id);
  const gaps = publishGaps({
    category: business.category,
    whatsapp: business.whatsapp,
    site: business.site,
    serviceCount: services.length,
  });
  if (publish && gaps.length > 0) return { ok: false, gaps, business };
  await setBusinessPublished(business.id, publish);
  const fresh = (await getBusinessByUserId(business.userId))!;
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
    const site = { ...business.site };
    if (kind === "logo") site.logoUrl = blob.url;
    else if (kind === "cover") site.coverUrl = blob.url;
    else site.gallery = [...site.gallery, blob.url];
    await updateBusinessSite(business.id, site);
  } catch (err) {
    console.error("[store] upload failed", err);
    return { ok: false, error: "failed" };
  }
  const fresh = (await getBusinessByUserId(business.userId))!;
  refresh(fresh.slug);
  return { ok: true, business: fresh };
}

export async function removeStoreImageAction(kind: "logo" | "cover" | "gallery", url?: string): Promise<BusinessRow> {
  const business = await requireBusiness();
  const site = { ...business.site };
  if (kind === "logo") site.logoUrl = "";
  else if (kind === "cover") site.coverUrl = "";
  else site.gallery = site.gallery.filter((g) => g !== url);
  await updateBusinessSite(business.id, site);
  const fresh = (await getBusinessByUserId(business.userId))!;
  refresh(fresh.slug);
  return fresh;
}
