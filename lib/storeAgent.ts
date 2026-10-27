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
  updateBusinessWhatsapp,
  updateService,
  setServiceAgent,
  type BusinessRow,
  type ServiceRow,
} from "./db";
import { LIMITS, missingForSales, normalizePhone, parseSite, publishGaps, safeUrl, type SiteData } from "./site";
import { publishBusiness } from "./marketplace";
import { planFingerprint } from "./planToStore";
import { AGENT_LIMITS, AGENT_MIN_CENTS, agentMissing, offerPriceLabel, parseServiceAgent, parseTask, taskMissing, welcomeLabel } from "./serviceAgentConfig";

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
        reachMode: { type: "string", enum: ["local", "remote"], description: "local = done in person in an area (needs reachCity + reachRadiusMiles); remote = done online from anywhere" },
        reachCity: { type: "string", description: "Local: base city with state, or a 5-digit ZIP, e.g. 'Miami, FL' or '33172'" },
        reachRadiusMiles: { type: "number", description: "Local: how many miles they travel (1-300)" },
        reachScope: { type: "string", enum: ["us", "state", "world"], description: "Remote: customers in the whole US (us), only in one state (state, with reachState) or also other countries (world)" },
        reachState: { type: "string", description: "Remote with reachScope=state: the US state, e.g. 'TX' or 'Texas'" },
        ownerName: { type: "string", description: "The owner's first name (or how they want to be called). Customers see it in the page chat when the owner answers personally." },
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
        ctaNote: { type: "string", description: "Tiny line under the chat, e.g. 'We reply in minutes, Mon–Sat 8am–6pm' (owner facts only)" },
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
    description: "Use an uploaded photo: as the logo, the main/cover photo, in the gallery, as the owner's own photo (shown next to their name when they answer chats; it stays where it is on the page), or remove it.",
    input_schema: {
      type: "object",
      properties: { url: { type: "string" }, role: { type: "string", enum: ["cover", "logo", "gallery", "owner", "remove"] } },
      required: ["url", "role"],
    },
  },
  {
    name: "remove_video",
    description: "Remove the page's video (only when the owner asks).",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "update_agent",
    description:
      "Service agent only: change the AI agent that delivers the owner's service in the page chat. Send only what changes. enabled=true switches it on in the page chat (only after the owner clearly says yes).",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "The agent's name, e.g. 'Tutor Kevin IA'" },
        role: { type: "string", description: "One line: what it does for each customer" },
        instructions: { type: "string", description: "Its method, step by step (replaces the old one)" },
        knowledgeAdd: { type: "string", description: "Owner's notes/materials to ADD to what the agent knows (keep the owner's own words)" },
        knowledgeReplace: { type: "string", description: "Replace everything the agent knows (only if the owner asks)" },
        limits: { type: "array", items: { type: "string" }, description: "What it must never do / when the owner steps in (replaces the list)" },
        greeting: { type: "string", description: "Its first message; must say it's an AI agent" },
        freeReplies: { type: "number", description: "Free replies before paying (0-10)" },
        creator: { type: "string", description: "Shown on the page as 'Created by': only the creator's name, as they gave it. Never credentials, years or a story." },
        edge: { type: "array", items: pointSchema, description: "Shown on the page: 3-4 true reasons to pay for this agent instead of a free AI chat (replaces the list)" },
        welcomePercent: { type: "number", description: "Welcome offer: % off a new customer's first purchase (0 = none, max 50)" },
        welcomeOn: { type: "string", enum: ["all", "once", "monthly"], description: "Which offers the welcome % applies to (monthly = the first month)" },
        enabled: { type: "boolean" },
      },
    },
  },
  {
    name: "set_agent_task",
    description:
      "Service agent only: the complete task the agent DOES itself, end to end, on the official pages or software (it doesn't just guide). Replaces the whole task. Required before switching it on.",
    input_schema: {
      type: "object",
      properties: {
        goal: { type: "string", description: "The finished result it delivers, e.g. 'Crear tu LLC en Florida y entregarte el número de documento oficial'" },
        platforms: { type: "array", items: { type: "object", properties: { name: { type: "string" }, url: { type: "string", description: "https link to the official page or software it operates" } }, required: ["name", "url"] } },
        needs: { type: "array", items: { type: "string" }, description: "Ordinary data it asks in the chat (no passwords, cards or SSN)" },
        sensitive: { type: "array", items: { type: "object", properties: { what: { type: "string" }, when: { type: "string" } }, required: ["what", "when"] }, description: "What the customer types themselves on the official page, and at which moment" },
        confirmBefore: { type: "array", items: { type: "string" }, description: "Steps that need the customer's OK (sign, submit, pay)" },
        verify: { type: "string", description: "How it proves it's done (confirmation number, document, official record)" },
        deliver: { type: "string", description: "What the customer receives in the chat" },
        reminders: { type: "string", description: "Proactive reminders after it's done (deadlines), if any" },
      },
      required: ["goal", "platforms", "verify", "deliver"],
    },
  },
  {
    name: "set_agent_offers",
    description: "Service agent only: what customers can buy to use the agent (replaces all offers). Prices in USD, at least $15.",
    input_schema: {
      type: "object",
      properties: {
        offers: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              detail: { type: "string", description: "What they get, one line" },
              priceUsd: { type: "number" },
              billing: { type: "string", enum: ["once", "monthly"] },
              days: { type: "number", description: "once: days of access (use hours for less than a day)" },
              hours: { type: "number" },
              replies: { type: "number", description: "Replies included (optional)" },
            },
            required: ["title", "priceUsd", "billing"],
          },
        },
      },
      required: ["offers"],
    },
  },
  {
    name: "publish_page",
    description: "Publish (or unpublish) the page. Only after the owner clearly says yes.",
    input_schema: { type: "object", properties: { publish: { type: "boolean" } }, required: ["publish"] },
  },
];

const SYSTEM = `You are Sevrii's store builder. In this chat you build the owner's sales page — a one-page "product page" for a US service business, designed to turn visitors into chat messages and bookings (title, price, photos, offer, service options, selling points, how it works, FAQ).

How to work:
- Interview the owner like a friendly expert: ask ONE thing at a time (two only if tightly related), in plain short sentences. Follow the "missing" list in the page state, in that order. Explain in a few words why each thing sells ("los precios claros traen más clientes").
- As soon as the owner gives you information, save it with the tools in the same turn — don't wait until the end. Then confirm in one short line and ask the next question.
- Write persuasive copy yourself (headline, pitch, key points, steps, closing CTA) from the owner's facts. Benefit first, specific, no fluff.
- Services: get each service's name and price. Mark the main one as featured.
- Offer: ask if they have a current promotion. Only use a real one. A welcome offer for new customers (only their first service, e.g. "10% off your first cleaning") needs NO end date — never ask for one. Any other time-limited promotion needs its real end date. Never create fake urgency, fake discounts or "ends today" offers.
- Photos: it's a service, so people buy the PERSON. Ask first for a clear photo of the owner (smiling, work clothes, good light) and then photos of them working and of their work. If "brainPlan.photoIdeas" exists, suggest those exact shots. Ask them to send the photos right here in the chat with the + button next to the message box ("Súbeme aquí con el botón + …"), then place each one yourself with set_photo. When a photo is uploaded you SEE it (it's attached to the message). Say in a few words what it shows, then use set_photo: a clear photo of the person = cover, and also set_photo role=owner (customers see it next to their name when they answer chats) if "page.ownerPhotoUrl" is empty; their work or tools = gallery (or cover if there's no good photo of the person yet). If it has nothing to do with the service (a landscape, a random object, a meme), say so kindly, leave it out of the cover (keep it in the gallery only if the owner wants) and ask for the right kind of photo. Always tell the owner what you see in a photo they just uploaded. Never suggest stock photos.
- Video: if "page.videoUrl" is empty, recommend a short video of the owner talking about the service (30-60 s, phone, looking at the camera) — it builds the most trust and shows first in the gallery. They send it right here with the + button (it goes on the page automatically, first in the gallery). If "brainPlan.videoScript" exists, give them the script in a few short lines. To remove the video use remove_video. Don't push the video more than once per conversation.
- Contact: customers talk to the business through the chat on the page (it sits next to the price; an AI answers instantly with the page info, collects their name and phone, and alerts the owner, who can answer in "Conversaciones"/"Conversations"). The page has no call or text buttons, so don't ask for a phone or WhatsApp for the page. Ask the owner's first name once (if "page.ownerName" is empty) and save it as ownerName: when they answer a chat personally, customers see their name and photo, so they know they're talking with the real person. Remind them once to turn on alerts ("Avisos" in Conversaciones) so they never miss a customer.
- Service area: work it out yourself from what they say and save it with update_page — never show forms. If "page.reachMode" is empty: a service done at the customer's place (cleaning, moving, repairs, beauty at home…) is local → if you know their city (page, brainPlan or the chat), save reachMode=local with reachCity and ask only how many miles they travel (default 25 if they don't care); work that can be delivered online (video editing, design, bookkeeping, classes by video…) is remote → ask in one short question if they take customers in the whole US, only in their state (e.g. a state license or state paperwork) or other countries too, and save reachMode=remote with reachScope (and reachState for one state). If unsure, ask one plain question ("¿Lo haces en persona en tu zona o en línea?"). The marketplace only shows them to customers they can really serve.
- Licenses: do NOT ask about licenses — most services don't need one. Only if the owner mentions a license number on their own, save it (licenseNumber, licenseState) so it shows on the page.
- NEVER invent facts: no license numbers, insurance, years, reviews, ratings, guarantees, certifications, prices or response times the owner didn't give. If something is unknown, ask.
- Conversion coach: you are also their sales-page expert. Once the essentials are saved, give ONE concrete improvement per reply, the one with the biggest impact first, say in a few words why it brings more customers, and offer to do it: a clear photo of the owner as the main photo; a 30-60 s video of them; a welcome offer for first-time customers; a price on every package; their Google reviews link; FAQ answers to the top fears; notifications on so they answer chats fast. Never invent results or numbers.
- One service only: if they sell a single service, don't push them to invent more packages; the page focuses on that one service automatically (one price, no options to choose). If they have options (sizes, extras), suggest 2-3 packages.
- When the essentials are done (services with prices, the owner's name, photos or not, key points), tell them the page is ready, give a one-line summary, and ask if they want to publish. Call publish_page only after a clear yes. If publishing fails, tell them what's missing.
- If the owner asks for something the page can't do, say so briefly.
- "brainPlan" is the strategy the owner already made with Sevrii's Brain (service, customer, promise, differentiators, packages with prices, offer). Use it: propose the headline from the promise, key points from the differentiators and services from the packages, and confirm with the owner instead of asking from scratch. If the plan offer has forNewClients=true, use it without a date. Otherwise, if it has no endsAt, ask for a real end date before adding it to the page; if it has one, use that date.
- Service agent ("agent" in the state, when the owner is creating one): the page chat becomes their AI agent that delivers the service by itself and charges for access. An agent is a digital product that doesn't depend on what the owner knows: its knowledge base already comes from the Brain's official research. Help them finish it before publishing: its name and one-line role; its method step by step (instructions); if they WANT to add their own material, rules or answers, save it with knowledgeAdd in their own words (optional, never a requirement, never invent facts); its limits (always: it says it's an AI, never promises results, the owner handles refunds and cases outside the service); its greeting; how many free replies (3 is a good start); and what customers buy (set_agent_offers: one-time access for N days and/or monthly, each $15 or more). A welcome offer for new customers is set with update_agent welcomePercent (and welcomeOn): it applies only to a customer's first purchase and never takes a price under $15. If "agent.paymentsReady" is false, tell them once that to charge they must connect Payments (left menu) — until then the agent only gives the free replies and then passes the chat to them. Then ask if they want to switch it on (update_agent enabled=true) and suggest testing it themselves on "Ver borrador" (as the owner they can chat for free). The page itself still needs a headline, a photo of the owner and publishing like any page. An agent's page is different from a normal service page: it shows "AI agent · 24/7", the free trial, the chat first, who created it (creator + the owner's photo), why it's worth paying for instead of a free AI chat (edge), its access prices and its limits. So for an agent don't ask for hours, service area, license or years in business; don't ask for photos of their work; their photo is optional (it shows next to "created by", with their name only), and make sure edge is true and concrete. 
- The agent DOES the task, it doesn't just guide (the new Sevrii model). Before switching it on, define with the owner, in plain words and one question at a time, the complete task with set_agent_task: (1) what it finishes end to end (the result the customer gets, e.g. "deja la LLC creada", "deja la cita hecha"); (2) which official pages or software it operates (https links, official sources first); (3) which ordinary data it asks in the chat; (4) which sensitive data the customer types themselves on the official page and at what moment (passwords, card when paying a fee) — never in the chat, never stored; (5) which steps need the customer's OK (signing, submitting, paying); (6) how it proves it's done (confirmation number, document, official record) — if it can't be verified it stays pending; (7) what the customer receives in the chat; (8) reminders afterwards, if any. If "agent.taskMissing" isn't empty, it can't be switched on: say what's missing. It never replaces a licensed professional when the law requires one, never signs or pays without the customer's explicit OK, and never promises an outcome that depends on the office.
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
    ...(b.plan.mode === "agent" || b.serviceAgent.name
      ? {
          agent: {
            ...b.serviceAgent,
            knowledge: b.serviceAgent.knowledge.slice(0, 1500),
            knowledgeChars: b.serviceAgent.knowledge.length,
            offers: b.serviceAgent.offers.map((o) => ({ ...o, label: offerPriceLabel(o, b.site.lang), welcome: welcomeLabel(b.serviceAgent, o, b.site.lang) || null })),
            missing: agentMissing(b.serviceAgent),
            // What it DOES end to end; without it, it can't be switched on.
            taskMissing: taskMissing(b.serviceAgent.task),
            paymentsReady: b.payStatus === "ready",
          },
        }
      : {}),
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
      if (typeof input.accentColor === "string" && /^#[0-9a-fA-F]{6}$/.test(input.accentColor)) await updateBusinessAccent(b.id, input.accentColor);

      const patch: Record<string, unknown> = {};
      for (const k of [
        "headline", "serviceArea", "hours", "licenseNumber", "licenseState", "noLicenseNeeded", "insured",
        "spanish", "yearsInBusiness", "googleReviewsUrl", "keyPoints", "steps", "features", "faq", "ctaTitle", "ctaText",
        "ctaNote", "disclaimer", "lang", "ownerName",
      ]) {
        if (input[k] !== undefined) patch[k] = input[k];
      }
      if (input.reachMode === "remote") {
        patch.reachMode = "remote";
        const { stateCode } = await import("./geo");
        const st = stateCode(String(input.reachState || "")) || stateCode(b.site.baseState || "") || stateCode(b.plan.profile.state || "");
        if (input.reachScope === "state" && !st) notes.push("reachState: which US state? ask the owner");
        patch.reachScope = input.reachScope === "world" ? "world" : input.reachScope === "state" && st ? "state" : "us";
        if (st && input.reachScope === "state") patch.baseState = st;
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
      // With a service agent, the page's welcome offer ("15% off your first
      // month") is also what the agent's checkout charges on a first purchase.
      if ((b.plan.mode === "agent" || b.serviceAgent.name) && (input.clearOffer || input.offer)) {
        const o = (input.offer ?? {}) as Record<string, unknown>;
        const text = `${o.label ?? ""} ${o.detail ?? ""}`;
        const pct = input.clearOffer ? 0 : Number(/(\d{1,2})\s*%/.exec(text)?.[1] ?? 0);
        if (input.clearOffer || pct) {
          await setServiceAgent(
            b.id,
            parseServiceAgent({ ...b.serviceAgent, welcomePercent: pct, welcomeOn: /\b(mes|mensual|month|monthly)\b/i.test(text) ? "monthly" : "all" })
          );
          notes.push(pct ? `the agent's checkout now takes ${pct}% off a new customer's first purchase` : "the agent's welcome discount was removed");
        }
      }
      const problems = notes.filter((n) => !n.startsWith("the agent's"));
      const info = notes.filter((n) => n.startsWith("the agent's"));
      return `${problems.length ? `saved, with problems: ${problems.join("; ")}` : "saved"}${info.length ? `; ${info.join("; ")}` : ""}`;
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
      const known = new Set([cur.coverUrl, cur.logoUrl, cur.ownerPhotoUrl, ...cur.gallery].filter(Boolean));
      if (!url || !known.has(url)) return "error: unknown photo url";
      if (input.role === "owner") {
        await mergeBusinessSite(b.id, cur, { ownerPhotoUrl: url });
        return "saved as the owner's photo";
      }
      const site = { ...cur, gallery: cur.gallery.filter((g) => g !== url) };
      if (site.coverUrl === url) site.coverUrl = "";
      if (site.logoUrl === url) site.logoUrl = "";
      if (input.role === "cover") {
        if (site.coverUrl) site.gallery = [site.coverUrl, ...site.gallery];
        site.coverUrl = url;
      } else if (input.role === "logo") site.logoUrl = url;
      else if (input.role === "gallery") site.gallery = [...site.gallery, url];
      const ownerPhotoUrl = input.role === "remove" && cur.ownerPhotoUrl === url ? "" : cur.ownerPhotoUrl;
      await mergeBusinessSite(b.id, cur, { coverUrl: site.coverUrl, logoUrl: site.logoUrl, gallery: site.gallery, ownerPhotoUrl });
      return "saved";
    }
    case "remove_video": {
      const cur = (await getBusinessById(b.id))?.site ?? b.site;
      if (!cur.videoUrl) return "there is no video on the page";
      await mergeBusinessSite(b.id, cur, { videoUrl: "" });
      return "video removed from the page";
    }
    case "update_agent": {
      const a = b.serviceAgent;
      const next = { ...a };
      if (typeof input.name === "string") next.name = input.name;
      if (typeof input.role === "string") next.role = input.role;
      if (typeof input.instructions === "string") next.instructions = input.instructions;
      if (typeof input.knowledgeReplace === "string") next.knowledge = input.knowledgeReplace;
      if (typeof input.knowledgeAdd === "string" && input.knowledgeAdd.trim()) next.knowledge = `${next.knowledge ? `${next.knowledge}\n\n` : ""}${input.knowledgeAdd.trim()}`;
      if (Array.isArray(input.limits)) next.limits = input.limits.filter((x): x is string => typeof x === "string");
      if (typeof input.greeting === "string") next.greeting = input.greeting;
      if (typeof input.freeReplies === "number") next.freeReplies = input.freeReplies;
      if (typeof input.welcomePercent === "number") next.welcomePercent = input.welcomePercent;
      if (typeof input.creator === "string") next.creator = input.creator;
      if (Array.isArray(input.edge)) next.edge = input.edge as { title: string; text: string }[];
      if (input.welcomeOn === "all" || input.welcomeOn === "once" || input.welcomeOn === "monthly") next.welcomeOn = input.welcomeOn;
      const notes: string[] = [];
      if (next.knowledge.length > AGENT_LIMITS.knowledge) notes.push(`knowledge was cut to ${AGENT_LIMITS.knowledge} characters`);
      if (typeof input.enabled === "boolean") {
        const parsed = parseServiceAgent(next);
        // Switching it on needs the complete task it does (no task, no agent).
        const missing = input.enabled && !a.enabled ? [...agentMissing(parsed), ...taskMissing(parsed.task).map((x) => `task.${x}`)] : agentMissing(parsed);
        if (input.enabled && missing.length) notes.push(`not switched on, missing: ${missing.join(", ")}${missing.some((m) => m.startsWith("task.")) ? " (define what it does end to end with set_agent_task)" : ""}`);
        else next.enabled = input.enabled;
      }
      const saved = parseServiceAgent(next);
      await setServiceAgent(b.id, saved);
      if (saved.enabled && !a.enabled) notes.push(b.payStatus === "ready" && saved.offers.length ? "switched on: the page chat is now the agent" : "switched on: the page chat is now the agent, but it can't charge yet (no offers or Payments not connected): after the free replies it passes the chat to the owner");
      return `saved${notes.length ? `; ${notes.join("; ")}` : ""}`;
    }
    case "set_agent_task": {
      const task = parseTask(input);
      const gaps = taskMissing(task);
      await setServiceAgent(b.id, parseServiceAgent({ ...b.serviceAgent, task }));
      return gaps.length ? `saved, but still missing: ${gaps.join(", ")} (goal = the finished result; platforms = official https links; verify = the proof; deliver = what the customer gets)` : "saved: the agent now has its complete task";
    }
    case "set_agent_offers": {
      const list = Array.isArray(input.offers) ? input.offers : [];
      const notes: string[] = [];
      const offers = list.slice(0, AGENT_LIMITS.offers).map((x, i) => {
        const o = (x ?? {}) as Record<string, unknown>;
        const cents = Math.round(Number(o.priceUsd) * 100);
        if (!(cents >= AGENT_MIN_CENTS)) notes.push(`"${String(o.title ?? "").slice(0, 40)}" left out: the minimum price is $15`);
        const hours = Number(o.days) > 0 ? Number(o.days) * 24 : Number(o.hours) > 0 ? Number(o.hours) : 24;
        return { id: `o${i + 1}`, title: o.title, detail: o.detail ?? "", priceCents: cents, billing: o.billing === "monthly" ? "monthly" : "once", hours, ...(Number(o.replies) > 0 ? { replies: Number(o.replies) } : {}) };
      });
      const saved = parseServiceAgent({ ...b.serviceAgent, offers });
      await setServiceAgent(b.id, saved);
      return `saved ${saved.offers.length} offer(s)${notes.length ? `; ${notes.join("; ")}` : ""}${b.payStatus === "ready" ? "" : "; Payments isn't connected yet, so customers can't pay until the owner connects it"}`;
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
    .flatMap((t) => t.match(BLOB) ?? [])
    // Only photos go to the model as images (a video link would make it fail).
    .filter((u) => !/\/video-|\.(mp4|mov|m4v|webm|qt)(\?|$)/i.test(u));
  const photos = [...new Set(recent)].slice(0, 2);
  const justUploaded = (opts.message.match(BLOB) ?? []).some((u) => photos[0] === u);
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

  return { reply: reply || (es ? "Listo." : "Done."), business, services };
}

// First message when the chat is empty — no AI call needed.
export function storeGreeting(lang: Lang, b: BusinessRow, serviceCount: number): string {
  const es = lang === "es";
  if (b.plan.mode === "agent" && b.serviceAgent.name && !b.serviceAgent.enabled) {
    return es
      ? `¡Hola! Ya armé el primer borrador de tu agente, "${b.serviceAgent.name}", con tu estrategia del Cerebro. Para que trabaje bien necesita tu conocimiento: pégame aquí tus apuntes, reglas o respuestas a las preguntas que más te hacen, y lo dejo listo para probarlo.`
      : `Hi! I built the first draft of your agent, "${b.serviceAgent.name}", from your Brain strategy. To work well it needs your knowledge: paste your notes, rules or answers to the questions you get most, and I'll get it ready to test.`;
  }
  if (b.plan.service && b.plan.packages.length > 0 && b.site.fromPlan !== planFingerprint(b.plan)) {
    return es
      ? `¡Hola! Ya tengo la estrategia que armaste en el Cerebro para "${b.plan.service}". Con eso armo la página de ${b.name}: título, puntos clave y tus paquetes con precio. ¿La armo así y luego la revisamos juntos?`
      : `Hi! I have the strategy you built in the Brain for "${b.plan.service}". I'll use it for ${b.name}'s page: headline, key points and your priced packages. Shall I build it that way and then we review it together?`;
  }
  if (serviceCount > 0 || b.site.headline) {
    if (b.plan.mode === "agent" && b.serviceAgent.name)
      return es
        ? `Tu agente y su página ya están armados con lo que aprobamos. Aquí abajo tienes el resumen, y con «Ver mi página» la ves completa. Aquí puedo darle más información, cambiar sus precios, el título o la oferta, y agregar fotos o un video. ¿Qué quieres cambiar?`
        : `Your agent and its page are built from what we approved. The summary is right below, and "See my page" shows it in full. Here I can give it more information, change its prices, the headline or the offer, and add photos or a video. What do you want to change?`;
    return es
      ? `Tu página ya está armada con lo que aprobamos. Aquí abajo tienes el resumen, y con «Ver mi página» la ves completa. Aquí puedo agregar fotos o un video, cambiar el título, la oferta o los precios. ¿Qué quieres cambiar?`
      : `Your page is built from what we approved. The summary is right below, and "See my page" shows it in full. Here I can add photos or a video, change the headline, the offer or the prices. What do you want to change?`;
  }
  return es
    ? `¡Hola! Voy a armar contigo la página de ${b.name} para que más clientes te escriban. Para empezar: ¿qué servicio quieres vender y cuánto cuesta?`
    : `Hi! I'll build ${b.name}'s page with you so more customers message you. To start: what service do you want to sell, and how much does it cost?`;
}
