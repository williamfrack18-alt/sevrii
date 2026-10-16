import type { MessageParam, Tool, ToolResultBlockParam, ToolUseBlock, TextBlock } from "@anthropic-ai/sdk/resources/messages";
import { MODEL, getClaude, logAiError } from "./claude";
import type { Lang } from "./i18n";
import {
  addService,
  deleteService,
  getBusinessById,
  listServices,
  mergeBusinessSite,
  updateBusinessAccent,
  updateBusinessDetails,
  updateBusinessSite,
  updateBusinessWhatsapp,
  updateService,
  type BusinessRow,
  type ServiceRow,
} from "./db";
import { LIMITS, missingForSales, normalizePhone, parseSite, publishGaps, safeUrl, type SiteData } from "./site";
import { publishBusiness } from "./marketplace";
import { planFingerprint } from "./planToStore";

// The Store tab is one chat. This agent interviews the owner for exactly the
// data the conversion template needs (services and prices, offer, photos,
// selling points, contact, license, area, hours, steps, FAQ) and writes it
// into the page as it goes. It never invents facts.

const pointSchema = {
  type: "object",
  properties: { title: { type: "string" }, text: { type: "string" } },
  required: ["title", "text"],
};

const TOOLS: Tool[] = [
  {
    name: "update_page",
    description:
      "Write fields of the owner's sales page. Send only the fields you are changing. Lists (keyPoints, steps, features, faq) replace the whole list.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Business name" },
        category: { type: "string", description: "Type of business, e.g. 'HVAC repair'" },
        headline: { type: "string", description: "Main title of the page: what they sell, benefit-led, max 80 chars" },
        pitch: { type: "string", description: "2-3 sentences under the title, max 380 chars" },
        city: { type: "string" },
        serviceArea: { type: "string", description: "e.g. 'Miami-Dade and Broward'" },
        hours: { type: "string", description: "e.g. 'Mon–Sat 8am–6pm'" },
        phone: { type: "string", description: "Phone for calls (and texts), US numbers like (305) 555-0123" },
        whatsapp: { type: "string", description: "WhatsApp number with country code (optional; many US customers don't use WhatsApp)" },
        textEnabled: { type: "boolean", description: "Whether the phone accepts text messages (SMS)" },
        contactPref: { type: "string", enum: ["", "call", "text", "whatsapp", "chat"], description: "The owner's favorite way to be contacted; it becomes the main button. '' = automatic (call/text first)" },
        reachMode: { type: "string", enum: ["local", "remote"], description: "local = done in person in an area (needs reachCity + reachRadiusMiles); remote = done online from anywhere" },
        reachCity: { type: "string", description: "Local: base city with state, or a 5-digit ZIP, e.g. 'Miami, FL' or '33172'" },
        reachRadiusMiles: { type: "number", description: "Local: how many miles they travel (1-300)" },
        reachScope: { type: "string", enum: ["us", "world"], description: "Remote: customers in the whole US (us) or also other countries (world)" },
        ownerName: { type: "string", description: "The owner's first name (or how they want to be called). Customers see it in the page chat when the owner answers personally." },
        chat: { type: "boolean", description: "Show the chat on the page (an AI assistant answers visitors instantly with the page info and passes them to the owner). On by default." },
        licenseNumber: { type: "string", description: "ONLY a number the owner typed" },
        licenseState: { type: "string" },
        noLicenseNeeded: { type: "boolean", description: "Owner said their trade needs no license in their state" },
        insured: { type: "boolean", description: "ONLY if the owner said they carry insurance" },
        spanish: { type: "boolean", description: "Owner serves customers in Spanish" },
        yearsInBusiness: { type: "number", description: "ONLY if the owner said it" },
        googleReviewsUrl: { type: "string", description: "https link to their Google reviews" },
        keyPoints: { type: "array", items: pointSchema, description: "3-5 selling points shown as a checklist next to the buy buttons. title = 2-4 words, text = one short line. Based only on owner facts." },
        offer: {
          type: "object",
          description: "A REAL promotion the owner confirmed. endsAt = real end date (ISO, e.g. 2026-10-31) or empty if it has no end.",
          properties: { label: { type: "string" }, oldPrice: { type: "string" }, newPrice: { type: "string" }, endsAt: { type: "string" } },
          required: ["label"],
        },
        clearOffer: { type: "boolean", description: "Remove the current offer" },
        steps: { type: "array", items: pointSchema, description: "3 steps of how they work with a customer" },
        features: { type: "array", items: { type: "string" }, description: "Up to 5 short facts for the trust bar (e.g. 'Same-day appointments'), only owner facts" },
        faq: {
          type: "array",
          items: { type: "object", properties: { q: { type: "string" }, a: { type: "string" } }, required: ["q", "a"] },
          description: "FAQ; answers only with facts the owner gave",
        },
        ctaTitle: { type: "string", description: "Closing section title" },
        ctaText: { type: "string" },
        ctaNote: { type: "string", description: "Tiny line under the buttons, e.g. 'We answer calls and texts 8am–8pm' (owner facts only)" },
        disclaimer: { type: "string", description: "Optional legal note the owner wants in the footer" },
        accentColor: { type: "string", description: "Hex color like #0B5FFF" },
        lang: { type: "string", enum: ["es", "en"], description: "Language of the public page" },
      },
    },
  },
  {
    name: "save_service",
    description: "Add a service (no id) or update one (with its id from the page state).",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        price: { type: "string", description: "Exactly as the owner said, e.g. 'From $149', '$99', '$80/hour'. Empty if they gave none." },
        description: { type: "string", description: "One sentence" },
        featured: { type: "boolean", description: "Main / most important service (highlighted)" },
        tag: { type: "string", description: "Short label for a featured service, e.g. 'Most requested' — only if true" },
      },
      required: ["name"],
    },
  },
  {
    name: "delete_service",
    description: "Delete a service by id.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "set_photo",
    description: "Use an uploaded photo: as the logo, the main/cover photo, in the gallery, or remove it.",
    input_schema: {
      type: "object",
      properties: { url: { type: "string" }, role: { type: "string", enum: ["cover", "logo", "gallery", "remove"] } },
      required: ["url", "role"],
    },
  },
  {
    name: "show_panel",
    description:
      "Show an interactive box right under your message, inside this chat, so the owner can do it themselves: media = upload and order photos and their video (with the Brain's video script); reach = choose where they offer the service (in person in a city + miles, or online). Use it every time you ask for photos/video or for the service area.",
    input_schema: { type: "object", properties: { panel: { type: "string", enum: ["media", "reach"] } }, required: ["panel"] },
  },
  {
    name: "publish_page",
    description: "Publish (or unpublish) the page. Only after the owner clearly says yes.",
    input_schema: { type: "object", properties: { publish: { type: "boolean" } }, required: ["publish"] },
  },
];

const SYSTEM = `You are Sevrii's store builder. In this chat you build the owner's sales page — a one-page "product page" for a US service business, designed to turn visitors into calls, texts, quote requests and messages (title, price, photos, offer, service options, selling points, how it works, FAQ).

How to work:
- Interview the owner like a friendly expert: ask ONE thing at a time (two only if tightly related), in plain short sentences. Follow the "missing" list in the page state, in that order. Explain in a few words why each thing sells ("los precios claros generan más llamadas").
- As soon as the owner gives you information, save it with the tools in the same turn — don't wait until the end. Then confirm in one short line and ask the next question.
- Write persuasive copy yourself (headline, pitch, key points, steps, closing CTA) from the owner's facts. Benefit first, specific, no fluff.
- Services: get each service's name and price. Mark the main one as featured.
- Offer: ask if they have a current promotion. Only use a real one. A welcome offer for new customers (only their first service, e.g. "10% off your first cleaning") needs NO end date — never ask for one. Any other time-limited promotion needs its real end date. Never create fake urgency, fake discounts or "ends today" offers.
- Photos: it's a service, so people buy the PERSON. Ask first for a clear photo of the owner (smiling, work clothes, good light) and then photos of them working and of their work. If "brainPlan.photoIdeas" exists, suggest those exact shots. Show the photo box with show_panel("media") (they can also tap the + button or "📷 Fotos y video" above the message box). When a photo is uploaded you SEE it (it's attached to the message). Say in a few words what it shows, then use set_photo: a clear photo of the person = cover; their work or tools = gallery (or cover if there's no good photo of the person yet). If it has nothing to do with the service (a landscape, a random object, a meme), say so kindly, leave it out of the cover (keep it in the gallery only if the owner wants) and ask for the right kind of photo. Always tell the owner what you see in a photo they just uploaded. Never suggest stock photos.
- Video: if "page.videoUrl" is empty, recommend a short video of the owner talking about the service (30-60 s, phone, looking at the camera) — it builds the most trust and shows first in the gallery. They upload it in the photo and video box: show it with show_panel("media") (the Brain's script is there too). Photos can also be added and ordered there. Don't push the video more than once per conversation.
- Contact: customers talk to the business through the chat on the page (it sits next to the price; an AI answers instantly with the page info, collects their name and phone, and alerts the owner, who can answer in "Conversaciones"/"Conversations"). The page has no call or text buttons, so don't ask for a phone or WhatsApp for the page. Ask the owner's first name once (if "page.ownerName" is empty) and save it as ownerName: when they answer a chat personally, customers see their name and photo, so they know they're talking with the real person. Remind them once to turn on alerts (🔔 Avisos in Conversaciones) so they never miss a customer.
- Service area: if "page.reachMode" is empty, ask whether they do the work in person in an area (cleaning, moving, repairs…) or online from anywhere (video editing, design…). Show the box with show_panel("reach") so they can pick it, or save it yourself from their answer: local → reachMode=local, reachCity (city or ZIP), reachRadiusMiles; online → reachMode=remote and reachScope (us / world). The marketplace only shows them to customers they can really serve.
- Licenses: do NOT ask about licenses — most services don't need one. Only if the owner mentions a license number on their own, save it (licenseNumber, licenseState) so it shows on the page.
- NEVER invent facts: no license numbers, insurance, years, reviews, ratings, guarantees, certifications, prices or response times the owner didn't give. If something is unknown, ask.
- Conversion coach: you are also their sales-page expert. Once the essentials are saved, give ONE concrete improvement per reply, the one with the biggest impact first, say in a few words why it brings more customers, and offer to do it: a clear photo of the owner as the main photo; a 30-60 s video of them; a welcome offer for first-time customers; a price on every package; their Google reviews link; FAQ answers to the top fears; notifications on so they answer chats fast. Never invent results or numbers.
- One service only: if they sell a single service, don't push them to invent more packages; the page focuses on that one service automatically (one price, no options to choose). If they have options (sizes, extras), suggest 2-3 packages.
- When the essentials are done (services with prices, contact, photos or not, key points), tell them the page is ready, give a one-line summary, and ask if they want to publish. Call publish_page only after a clear yes. If publishing fails, tell them what's missing.
- If the owner asks for something the page can't do, say so briefly.
- "brainPlan" is the strategy the owner already made with Sevrii's Brain (service, customer, promise, differentiators, packages with prices, offer). Use it: propose the headline from the promise, key points from the differentiators and services from the packages, and confirm with the owner instead of asking from scratch. If the plan offer has forNewClients=true, use it without a date. Otherwise, if it has no endsAt, ask for a real end date before adding it to the page; if it has one, use that date.
- Keep every reply under 70 words. No markdown headings, no bullet lists longer than 4 items.`;

export type StoreChatResult = { reply: string; business: BusinessRow; services: ServiceRow[] };

function pageState(b: BusinessRow, services: ServiceRow[]) {
  const priced = services.filter((s) => (s.price ?? "").trim()).length;
  return {
    business: { name: b.name, category: b.category, city: b.city, pitch: b.pitch, whatsapp: b.whatsapp, accentColor: b.accentColor, published: Boolean(b.published) },
    brainPlan: b.plan.service ? { service: b.plan.service, customer: b.plan.customer, problem: b.plan.problem, promise: b.plan.promise, differentiators: b.plan.differentiators, packages: b.plan.packages, offer: b.plan.offer, photoIdeas: b.plan.photoIdeas, videoScript: b.plan.videoScript ? "ready" : "" } : null,
    page: b.site,
    services: services.map((s) => ({ id: s.id, name: s.name, price: s.price, description: s.description, featured: Boolean(s.featured), tag: s.tag ?? null })),
    missing: missingForSales({ category: b.category, whatsapp: b.whatsapp, site: b.site, serviceCount: services.length, pricedServices: priced }),
    publishBlockers: publishGaps({ category: b.category, whatsapp: b.whatsapp, site: b.site, serviceCount: services.length }),
  };
}

function clip(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

async function runTool(
  name: string,
  input: Record<string, unknown>,
  ctx: { business: BusinessRow; services: ServiceRow[]; canPublish: boolean }
): Promise<string> {
  const b = ctx.business;
  switch (name) {
    case "update_page": {
      const details: Partial<{ name: string; category: string; pitch: string; city: string | null }> = {};
      if (typeof input.name === "string" && input.name.trim()) details.name = clip(input.name, LIMITS.name);
      if (typeof input.category === "string" && input.category.trim()) details.category = clip(input.category, 60);
      if (typeof input.pitch === "string" && input.pitch.trim()) details.pitch = clip(input.pitch, LIMITS.pitch);
      if (typeof input.city === "string") details.city = clip(input.city, 80) || null;
      if (Object.keys(details).length) await updateBusinessDetails(b.id, details);

      const notes: string[] = [];
      if (typeof input.whatsapp === "string") {
        const wa = input.whatsapp.trim() ? normalizePhone(input.whatsapp) : "";
        if (wa === null) notes.push("whatsapp: invalid number, ask again");
        else await updateBusinessWhatsapp(b.id, wa);
      }
      if (typeof input.accentColor === "string" && /^#[0-9a-fA-F]{6}$/.test(input.accentColor)) await updateBusinessAccent(b.id, input.accentColor);

      const patch: Record<string, unknown> = {};
      for (const k of [
        "headline", "serviceArea", "hours", "textEnabled", "licenseNumber", "licenseState", "noLicenseNeeded", "insured",
        "spanish", "yearsInBusiness", "googleReviewsUrl", "keyPoints", "steps", "features", "faq", "ctaTitle", "ctaText",
        "ctaNote", "disclaimer", "lang", "contactPref", "chat", "ownerName",
      ]) {
        if (input[k] !== undefined) patch[k] = input[k];
      }
      if (typeof input.phone === "string") {
        const p = input.phone.trim() ? normalizePhone(input.phone) : "";
        if (p === null) notes.push("phone: invalid number, ask again (10 digits for US)");
        else patch.phone = p;
      }
      if (input.reachMode === "remote") {
        patch.reachMode = "remote";
        patch.reachScope = input.reachScope === "world" ? "world" : "us";
      } else if (input.reachMode === "local" || typeof input.reachCity === "string" || typeof input.reachRadiusMiles === "number") {
        const { lookupPlace } = await import("./geo");
        const where = typeof input.reachCity === "string" && input.reachCity.trim() ? lookupPlace(input.reachCity, b.site.baseState || undefined) : null;
        if (typeof input.reachCity === "string" && input.reachCity.trim() && !where) notes.push("reachCity: city not found, ask for their 5-digit ZIP code");
        else {
          if (where) Object.assign(patch, { baseCity: where.city, baseState: where.state, baseLat: where.lat, baseLon: where.lon });
          if (input.reachMode === "local" || where) patch.reachMode = "local";
          if (typeof input.reachRadiusMiles === "number") patch.reachRadius = Math.max(1, Math.min(300, Math.round(input.reachRadiusMiles)));
        }
      }
      if (input.clearOffer) patch.offer = null;
      else if (input.offer) patch.offer = input.offer;
      if (typeof input.googleReviewsUrl === "string" && input.googleReviewsUrl && !safeUrl(input.googleReviewsUrl)) {
        notes.push("googleReviewsUrl must be an https link");
      }
      if (Object.keys(patch).length) await mergeBusinessSite(b.id, b.site, patch as Partial<SiteData>);
      return notes.length ? `saved, with problems: ${notes.join("; ")}` : "saved";
    }
    case "save_service": {
      const nameV = clip(input.name, LIMITS.serviceName);
      const price = clip(input.price, LIMITS.servicePrice) || null;
      const description = clip(input.description, LIMITS.serviceDescription) || null;
      const featured = Boolean(input.featured);
      const tag = featured ? clip(input.tag, 30) || null : null;
      if (!nameV) return "error: name required";
      if (typeof input.id === "string" && input.id) {
        if (!ctx.services.some((s) => s.id === input.id)) return "error: unknown service id";
        await updateService(input.id, { name: nameV, price, description, featured, tag });
      } else {
        if (ctx.services.length >= 30) return "error: too many services";
        await addService(b.id, nameV, price ?? undefined, description ?? undefined, ctx.services.length);
        const fresh = await listServices(b.id);
        const created = fresh[fresh.length - 1];
        if (created && (featured || tag)) await updateService(created.id, { featured, tag });
      }
      return "saved";
    }
    case "delete_service": {
      if (typeof input.id !== "string" || !ctx.services.some((s) => s.id === input.id)) return "error: unknown service id";
      await deleteService(input.id);
      return "deleted";
    }
    case "set_photo": {
      const url = safeUrl(input.url);
      // Fresh copy: photos may have been uploaded while the AI was thinking.
      const cur = (await getBusinessById(b.id))?.site ?? b.site;
      // Only photos that belong to this store (uploaded through Sevrii) can be placed.
      const known = new Set([cur.coverUrl, cur.logoUrl, ...cur.gallery].filter(Boolean));
      if (!url || !known.has(url)) return "error: unknown photo url";
      const site = { ...cur, gallery: cur.gallery.filter((g) => g !== url) };
      if (site.coverUrl === url) site.coverUrl = "";
      if (site.logoUrl === url) site.logoUrl = "";
      if (input.role === "cover") {
        if (site.coverUrl) site.gallery = [site.coverUrl, ...site.gallery];
        site.coverUrl = url;
      } else if (input.role === "logo") site.logoUrl = url;
      else if (input.role === "gallery") site.gallery = [...site.gallery, url];
      await mergeBusinessSite(b.id, cur, { coverUrl: site.coverUrl, logoUrl: site.logoUrl, gallery: site.gallery });
      return "saved";
    }
    case "publish_page": {
      if (input.publish && !ctx.canPublish) {
        return "not published: the owner is on the Free plan. Publishing needs the Starter plan ($29/month). Tell them their page is ready as a draft and that they can choose Starter in Plans (left menu) to publish it.";
      }
      if (input.publish) {
        const gaps = publishGaps({ category: b.category, whatsapp: b.whatsapp, site: b.site, serviceCount: ctx.services.length });
        if (gaps.length) return `not published, missing: ${gaps.join(", ")}`;
      }
      const after = await publishBusiness(b.id, Boolean(input.publish));
      return input.publish
        ? `published. It is also listed on the Sevrii marketplace (sevrii.com) in the category "${after.marketCategory}", so customers browsing that category can find it.`
        : "moved to draft (also removed from the Sevrii marketplace)";
    }
    default:
      return "error: unknown tool";
  }
}

export async function runStoreChatTurn(opts: {
  business: BusinessRow;
  reload: () => Promise<BusinessRow>;
  history: { role: "user" | "assistant"; content: string }[];
  message: string;
  lang: Lang;
  canPublish: boolean;
}): Promise<StoreChatResult> {
  let business = opts.business;
  let services = await listServices(business.id);
  const es = opts.lang === "es";
  const client = getClaude();
  if (!client) {
    console.error("[ai:store] ANTHROPIC_API_KEY is not set");
    return {
      reply: es
        ? "El asistente no está disponible en este momento. Inténtalo de nuevo en unos minutos."
        : "The assistant isn't available right now. Please try again in a few minutes.",
      business,
      services,
    };
  }

  // Photos the owner uploaded (our own Blob storage only), newest first: the
  // one in this message plus the latest ones from the chat, so the model can
  // still see them when the owner asks about them a message later.
  const BLOB = /https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\/[^\s"')]+/gi;
  const recent = [opts.message, ...opts.history.filter((h) => h.role === "user").map((h) => h.content).reverse()]
    .flatMap((t) => t.match(BLOB) ?? []);
  const photos = [...new Set(recent)].slice(0, 2);
  const justUploaded = (opts.message.match(BLOB) ?? []).length > 0;
  const system = `${SYSTEM}\n\nReply in ${es ? "Spanish (neutral, 'tú')" : "English"}. Page text goes in the page's language (page.lang) unless the owner asks otherwise.`;
  const messages: MessageParam[] = [
    ...opts.history.map((h): MessageParam => ({ role: h.role, content: h.content })),
    {
      role: "user",
      content: [
        ...photos.map((url) => ({ type: "image" as const, source: { type: "url" as const, url } })),
        {
          type: "text" as const,
          text: `${photos.length ? `Attached: the owner's latest uploaded photo${photos.length > 1 ? "s, newest first" : ""} (${photos.join(" , ")}).${justUploaded ? " The first one was JUST uploaded: describe it in a few words and decide where it goes." : ""}\n\n` : ""}Page state (JSON):\n${JSON.stringify(pageState(business, services))}\n\nOwner: ${opts.message}`,
        },
      ],
    },
  ];

  let reply = "";
  const panels = new Set<string>();
  try {
    for (let step = 0; step < 6; step++) {
      const res = await client.messages.create({
        model: MODEL,
        max_tokens: 3000,
        thinking: { type: "between_tools" },
        output_config: { effort: "low" },
        system,
        tools: TOOLS,
        messages,
      });
      const text = res.content
        .filter((c): c is TextBlock => c.type === "text")
        .map((c) => c.text)
        .join("\n")
        .trim();
      if (text) reply = text;
      const uses = res.content.filter((c): c is ToolUseBlock => c.type === "tool_use");
      if (res.stop_reason !== "tool_use" || uses.length === 0) break;

      const results: ToolResultBlockParam[] = [];
      for (const u of uses) {
        let out: string;
        if (u.name === "show_panel") {
          const panel = (u.input as { panel?: string })?.panel;
          if (panel === "media" || panel === "reach") panels.add(panel);
          results.push({ type: "tool_result", tool_use_id: u.id, content: "shown under your message" });
          continue;
        }
        try {
          out = await runTool(u.name, (u.input ?? {}) as Record<string, unknown>, { business, services, canPublish: opts.canPublish });
        } catch (err) {
          console.error("[ai:store] tool failed", u.name, err);
          out = "error: could not save";
        }
        business = await opts.reload();
        services = await listServices(business.id);
        results.push({ type: "tool_result", tool_use_id: u.id, content: out });
      }
      messages.push({ role: "assistant", content: res.content });
      messages.push({
        role: "user",
        content: [...results, { type: "text", text: `Updated page state (JSON):\n${JSON.stringify(pageState(business, services))}` }],
      });
    }
  } catch (err) {
    logAiError("store", err);
    reply = es
      ? "Tuve un problema para guardar eso. Inténtalo de nuevo en un momento."
      : "I had a problem saving that. Please try again in a moment.";
  }

  const cards = [...panels].map((p) => `[[card:${p}]]`).join("\n");
  return { reply: `${reply || (es ? "Listo." : "Done.")}${cards ? `\n${cards}` : ""}`, business, services };
}

// First message when the chat is empty — no AI call needed.
export function storeGreeting(lang: Lang, b: BusinessRow, serviceCount: number): string {
  const es = lang === "es";
  if (b.plan.service && b.plan.packages.length > 0 && b.site.fromPlan !== planFingerprint(b.plan)) {
    return es
      ? `¡Hola! Ya tengo la estrategia que armaste en el Cerebro para "${b.plan.service}". Con eso armo la página de ${b.name}: título, puntos clave y tus paquetes con precio. ¿La armo así y luego la revisamos juntos?`
      : `Hi! I have the strategy you built in the Brain for "${b.plan.service}". I'll use it for ${b.name}'s page: headline, key points and your priced packages. Shall I build it that way and then we review it together?`;
  }
  if (serviceCount > 0) {
    return es
      ? `¡Hola! Soy tu asistente de Sevrii y voy a armar contigo la página de ${b.name} para que te llamen y te escriban más. Ya tengo un borrador. Empecemos por lo que más vende: ¿cuáles son tus servicios y cuánto cobras por cada uno?`
      : `Hi! I'm your Sevrii assistant and I'll build ${b.name}'s page with you so more customers call and message you. I already have a draft. Let's start with what sells most: what services do you offer and how much do you charge for each?`;
  }
  return es
    ? `¡Hola! Voy a armar contigo la página de ${b.name} para que te llamen y te escriban más. Para empezar: ¿qué servicio quieres vender y cuánto cuesta?`
    : `Hi! I'll build ${b.name}'s page with you so more customers call and message you. To start: what service do you want to sell, and how much does it cost?`;
}
