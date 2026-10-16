"use server";

import { after } from "next/server";
import { addLead, getBusinessBySlug, getUserById, listLeads, type LeadRow } from "@/lib/db";
import { limitsFor } from "@/lib/billing";
import { getCurrentUser } from "@/lib/session";
import { allow, clientIp } from "@/lib/guard";
import { normalizePhone } from "@/lib/site";
import { notifyNewLead } from "@/lib/notify";

export type LeadInput = {
  slug: string;
  name: string;
  phone: string;
  email: string;
  service: string;
  message: string;
  contactPref: string;
  website?: string; // honeypot: real people never fill it
};

export type LeadResult = { ok: true } | { ok: false; error: "name" | "contact" | "email" | "phone" | "rate" | "closed" };

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[a-z]{2,24}$/i;

function clean(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
}

export async function submitLeadAction(input: LeadInput): Promise<LeadResult> {
  const business = await getBusinessBySlug(clean(input.slug, 80));
  if (!business || !business.site.quoteForm) return { ok: false, error: "closed" };
  // Same rule as the page itself: only live pages take requests (the owner can test on a draft).
  const viewer = await getCurrentUser().catch(() => null);
  const owner = await getUserById(business.userId);
  const live = Boolean(business.published && owner && limitsFor(owner).canPublish);
  if (!live && viewer?.id !== business.userId) return { ok: false, error: "closed" };

  // Bots fill every field; pretend it worked.
  if (clean(input.website, 200)) return { ok: true };

  const name = clean(input.name, 80);
  if (name.length < 2) return { ok: false, error: "name" };
  const rawPhone = clean(input.phone, 30);
  const email = clean(input.email, 254).toLowerCase();
  if (!rawPhone && !email) return { ok: false, error: "contact" };
  const phone = rawPhone ? normalizePhone(rawPhone) : "";
  if (rawPhone && !phone) return { ok: false, error: "phone" };
  if (email && !EMAIL_RE.test(email)) return { ok: false, error: "email" };

  const ip = await clientIp();
  if (!(await allow(`lead:${ip}:${business.id}`, 4, 60 * 60)) || !(await allow(`lead:${ip}`, 15, 24 * 60 * 60)) || !(await allow(`lead-biz:${business.id}`, 200, 24 * 60 * 60))) {
    return { ok: false, error: "rate" };
  }

  if (!(await allow("lead-global", 3000, 24 * 60 * 60))) return { ok: false, error: "rate" };

  // The preferred method must match what they left (no "text me" without a phone).
  let pref = ["call", "text", "whatsapp", "email"].includes(input.contactPref) ? input.contactPref : "";
  if (pref && pref !== "email" && !phone) pref = email ? "email" : "";
  if (pref === "email" && !email) pref = phone ? "text" : "";
  const lead = await addLead({
    businessId: business.id,
    name,
    phone: phone || "",
    email,
    service: clean(input.service, 100),
    message: clean(input.message, 1000),
    contactPref: pref,
  });
  after(() => notifyNewLead(business, lead));
  return { ok: true };
}

export async function listMyLeadsAction(): Promise<LeadRow[]> {
  const user = await getCurrentUser();
  if (!user?.business) return [];
  return listLeads(user.business.id, 50);
}
