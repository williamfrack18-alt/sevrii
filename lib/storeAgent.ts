import type { MessageParam, Tool, ToolResultBlockParam, ToolUseBlock, TextBlock } from "@anthropic-ai/sdk/resources/messages";
import { MODEL, aiErrorReply, getClaude, logAiError } from "./claude";
import type { Lang } from "./i18n";
import {
  addService,
  deleteService,
  getBusinessById,
  listServices,
  listPushSubs,
  mergeBusinessSite,
  updateBusinessAccent,
  updateBusinessDetails,
  updateBusinessWhatsapp,
  updateService,
  setServiceAgent,
  type BusinessRow,
  type ServiceRow,
} from "./db";
import { HIDEABLE, LIMITS, PAGE_DESIGNS, PAGE_SECTIONS, missingForSales, normalizePhone, parseSite, publishGaps, safeUrl, sectionOrder, type Hideable, type PageDesign, type PageSection, type SiteData } from "./site";
import { publishBusiness } from "./marketplace";
import { planFingerprint, planReadyForStore, refPriceUnconfirmed } from "./planToStore";
import { AGENT_LIMITS, AGENT_MIN_CENTS, agentMissing, offerPriceLabel, offerTarget, parseServiceAgent, parseTask, taskMissing, welcomeLabel } from "./serviceAgentConfig";

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
    description: "Add a service (no id) or update one (with its id from the page state). When updating, send only the fields that change (omitted fields keep their value); send price \"\" only to remove a price.",
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
      properties: {
        url: { type: "string" },
        role: { type: "string", enum: ["cover", "logo", "gallery", "owner", "remove"] },
        whatItIs: {
          type: "string",
          enum: ["work_photo", "owner_photo", "logo", "screenshot", "other"],
          description: "What the image really is. A screenshot of a screen (a web page, this panel, an app, a chat, text) is 'screenshot': it never goes on the page.",
        },
      },
      required: ["url", "role", "whatItIs"],
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
        welcomeOffer: { type: "string", description: "Id of the ONE offer the welcome % applies to, when the approved offer names a single package (e.g. 'o2'); empty string = by welcomeOn" },
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
    name: "set_layout",
    description:
      "Change how the page looks, beyond its texts: the price/offer cards inside the photo gallery, which sections show, the ORDER of the sections, the DESIGN of the first screen, which photo goes first, and what the owner said no to (so you never push it again). Use it whenever the owner wants something on the page shown, hidden, moved or removed.",
    input_schema: {
      type: "object",
      properties: {
        galleryCards: { type: "string", enum: ["auto", "on", "off"], description: "Price and offer cards inside the photo gallery: off = never, on = always, auto = only while there are no real photos" },
        hide: { type: "array", items: { type: "string", enum: [...HIDEABLE] }, description: "Parts to hide: trust (facts bar), offerBand (offer banner), services (packages list), photos (photo grid), steps (how it works), faq, cta (closing section); and on the first screen: media (the photo/video column), intro (the pitch and its key points), packages (the packages and info cards under the photos). The media column only shows with design classic or hero: when you show it on a simple-design page, also set design" },
        show: { type: "array", items: { type: "string", enum: [...HIDEABLE] }, description: "Parts to show (again), same names as hide" },
        order: { type: "array", items: { type: "string", enum: [...PAGE_SECTIONS] }, description: "The new order of the sections under the first screen, top to bottom (list every section you want placed; the rest keep their relative order after them)" },
        design: { type: "string", enum: [...PAGE_DESIGNS], description: "Look of the first screen: classic = photos left and details right; hero = a wide banner photo with the details centered under it; simple = text only, centered, no photo column" },
        firstPhoto: { type: "string", description: "URL of a gallery photo to put first" },
        declined: { type: "array", items: { type: "string", enum: ["video", "publish", "alerts", "reviews", "photos", "offer", "hours"] }, description: "Things the owner said no to (never suggest them again)" },
      },
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
- Contact: customers talk to the business through the chat on the page (it sits next to the price; an AI answers instantly with the page info, collects their name and phone, and alerts the owner, who can answer in "Conversaciones"/"Conversations"). The page has no call or text buttons, so don't ask for a phone or WhatsApp for the page. Never ask what the Brain interview already has ("brainPlan.profile": name, city, ZIP, radius, languages, years): use it. If "page.ownerName" is empty and "brainPlan.profile.ownerName" exists, save it as ownerName with update_page right away without asking; only if neither has it, ask the owner's first name once and save it as ownerName: when they answer a chat personally, customers see their name and photo, so they know they're talking with the real person. If "alertsOn" is false, remind them once to turn on alerts ("Avisos" in Conversaciones); never again after that.
- Service area: work it out yourself from what they say and save it with update_page — never show forms. If "page.reachMode" is empty: a service done at the customer's place (cleaning, moving, repairs, beauty at home…) is local → if you know their city (page, brainPlan or the chat), save reachMode=local with reachCity and ask only how many miles they travel (default 25 if they don't care); work that can be delivered online (video editing, design, bookkeeping, classes by video…) is remote → ask in one short question if they take customers in the whole US, only in their state (e.g. a state license or state paperwork) or other countries too, and save reachMode=remote with reachScope (and reachState for one state). If unsure, ask one plain question ("¿Lo haces en persona en tu zona o en línea?"). The marketplace only shows them to customers they can really serve.
- Licenses: do NOT ask about licenses — most services don't need one. Only if the owner mentions a license number on their own, save it (licenseNumber, licenseState) so it shows on the page.
- NEVER invent facts: no license numbers, insurance, years, reviews, ratings, guarantees, certifications, prices or response times the owner didn't give. If something is unknown, ask.
- The page and its FAQ use ONLY what the owner approved in the Brain plan (brainPlan) and what they tell you in this chat. Never add taxes, fees, surcharges, deposits, refund or cancellation policies, guarantees or anything the owner didn't approve. Never offer or suggest what the owner excluded (a language, a service, an area).
- Conversion coach: you are also their sales-page expert. Once the essentials are saved, and only when the owner asks what's next or after you finish something they asked, give ONE concrete improvement (never one they declined or already did), the one with the biggest impact first, say in a few words why it brings more customers, and offer to do it: a clear photo of the owner as the main photo; a 30-60 s video of them; a welcome offer for first-time customers; a price on every package; their Google reviews link; FAQ answers to the top fears; notifications on so they answer chats fast. Never invent results or numbers.
- One service only: if they sell a single service, don't push them to invent more packages; the page focuses on that one service automatically (one price, no options to choose). If they have options (sizes, extras), suggest 2-3 packages.
- When the essentials are done (services with prices, the owner's name, photos or not, key points), tell them the page is ready, give a one-line summary, and ask ONCE if they want to publish. Call publish_page only when they explicitly ask for it. If publishing fails, tell them what's missing.
- If the owner asks for something the page can't do, say so briefly.
- "brainPlan" is the strategy the owner already made with Sevrii's Brain (service, customer, promise, differentiators, packages with prices, offer). Use it: propose the headline from the promise, key points from the differentiators and services from the packages, and confirm with the owner instead of asking from scratch. If the plan offer has forNewClients=true, use it without a date. Otherwise, if it has no endsAt, ask for a real end date before adding it to the page; if it has one, use that date.
- Service agent ("agent" in the state, when the owner is creating one): the page chat becomes their AI agent that delivers the service by itself and charges for access. An agent is a digital product that doesn't depend on what the owner knows: its knowledge base already comes from the Brain's official research. Help them finish it before publishing: its name and one-line role; its method step by step (instructions); if they WANT to add their own material, rules or answers, save it with knowledgeAdd in their own words (optional, never a requirement, never invent facts); its limits (always: it says it's an AI, never promises results, the owner handles refunds and cases outside the service); its greeting; how many free replies (3 is a good start); and what customers buy (set_agent_offers: one-time access for N days and/or monthly, each $15 or more). A welcome offer for new customers is set with update_agent welcomePercent (and welcomeOn): it applies only to a customer's first purchase and never takes a price under $15. If "agent.paymentsReady" is false, tell them once that to charge they must connect Payments (left menu) — until then the agent only gives the free replies and then passes the chat to them. Then ask if they want to switch it on (update_agent enabled=true) and suggest testing it themselves with «Ver mi página» above the preview, or «Abrir su chat» in Agente (as the owner they can chat for free). The page itself still needs a headline, a photo of the owner and publishing like any page. An agent's page is different from a normal service page: it shows "AI agent · 24/7", the free trial, the chat first, who created it (creator + the owner's photo), why it's worth paying for instead of a free AI chat (edge), its access prices and its limits. So for an agent don't ask for hours, service area, license or years in business; don't ask for photos of their work; their photo is optional (it shows next to "created by", with their name only), and make sure edge is true and concrete. 
- The agent DOES the task, it doesn't just guide (the new Sevrii model). Before switching it on, define with the owner, in plain words and one question at a time, the complete task with set_agent_task: (1) what it finishes end to end (the result the customer gets, e.g. "deja la LLC creada", "deja la cita hecha"); (2) which official pages or software it operates (https links, official sources first); (3) which ordinary data it asks in the chat; (4) which sensitive data the customer types themselves on the official page and at what moment (passwords, card when paying a fee) — never in the chat, never stored; (5) which steps need the customer's OK (signing, submitting, paying); (6) how it proves it's done (confirmation number, document, official record) — if it can't be verified it stays pending; (7) what the customer receives in the chat; (8) reminders afterwards, if any. If "agent.taskMissing" isn't empty, it can't be switched on: say what's missing. It never replaces a licensed professional when the law requires one, never signs or pays without the customer's explicit OK, and never promises an outcome that depends on the office.
- Keep every reply under 70 words. No markdown headings, no bullet lists longer than 4 items.

How to think (always):
- Read what the owner REALLY asks in this message and do exactly that first, with your tools, in this same turn. Then stop. Don't add a new suggestion unless they ask what's next.
- You have full freedom over the page: texts and sections (update_page), services and prices (save_service, delete_service), photos (set_photo), and the layout (set_layout: price/offer cards in the gallery on/off, hide or show any section, move sections up or down with "order", change the design of the first screen with "design" — classic, hero (wide banner) or simple (text only) —, which photo goes first). The owner sees the real page live, right beside this chat, and it updates after every change you save (on a phone they switch between the chat and «Vista previa» with one button). They can also tap «Editar mi página» above the preview to change any text by touching it on the page, move sections with arrows, show or hide parts and pick the design; tell them so when they want to arrange things themselves.
- How the page started ("page.start"): "ready" = Sevrii's ready-to-sell template, already complete; "template" = a design the owner picked from the gallery; "blank" = the owner chose to build it from scratch, so every part starts hidden and they add what they want. On a blank page never fill or show parts on your own: show (set_layout.show) only the parts they ask for, one request at a time, with the content approved in the Brain, and suggest the next part only if they ask what to add.
- Never invent anything on the page: no photos, testimonials, reviews, results or prices that the owner didn't give or the Brain didn't approve.
- The Brain's expediente ("brainPlan") is already confirmed by the owner: never ask again what it or "cardAnswers" already say. "neverWants" is a sacred limit: nothing of it appears on the page, not even as a suggestion. "rejectedIdeas" are services they turned down: never propose them. A package with "ref": true is a market reference, not the owner's price: the page shows it without a price; ask the owner for their own price (one question) before putting one, and never present the reference as theirs. Write the page in "flowLanguage" when it's set. Never say "no tengo herramienta" or "no puedo" for something these tools do. If something truly can't be done, say so in one line and do the closest thing you can.
- Images: describe a NEW upload once, then classify it with set_photo (whatItIs). A screenshot of a screen (this panel, the page, an app, a chat, text) is never a work photo: don't put it on the page; look at what the owner points at in it and fix that. Never describe old photos again.
- Facts in the state are the truth: "published", "alertsOn", "ownerDeclined", "realPhotos", "hasVideo", "languages". Never ask for what's already done (alertsOn true = alerts are on) or what they declined. When they say no to something (video, publishing, reviews…), save it with set_layout.declined and never suggest it again.
- Publish (or unpublish) ONLY when the owner asks for it in their message ("publícala"). Don't keep asking "¿la publico?".
- Languages: only "languages" in the state. Never say they serve in English (or Spanish) if it isn't there.
- Button names on screen: the live preview of the page is right beside this chat; «Ver mi página» (above the preview; «Abrir página publicada» once it's published) opens it in a new tab, and «Editar mi página» edits it in place. There is no page summary under the chat.
- Sevrii, so you can guide them (a button to each section appears under your reply when it applies): Cerebro = their strategy; Store = this page; Conversaciones = customer chats and «Avisos» (notifications); Payments = card payment links for their services (Stripe; 5% per payment, everything included; they connect Stripe there once); Marketing = their strategy and ads on Facebook and Instagram with their own account, and AI videos; Planes = plans. After the page is ready and published, the next step is Marketing, and Payments to charge by card.
- If the owner is upset or insults you: one short, calm line that answers or does what they asked. No apology lists, no repeating the page status, no new suggestions.`;

// Publishing needs the owner's own words: "publícala / publish it", or a
// plain yes right after the Brain asked about publishing. "No", "todavía no",
// insults or "ok, inútil" never count.
const YES = /^\s*(s[ií]+|ok(ay)?|dale|claro|hazlo|adelante|de acuerdo|yes|yep|sure|go ahead|do it)[\s.!,]*(por favor|please|ya|ahora|now)?[\s.!]*$/i;
export function publishConsent(publish: boolean, ownerLast: string, lastAssistant: string): boolean {
  const t = ownerLast.trim();
  if (/\b(no|todav[ií]a no|a[uú]n no|not yet|don'?t)\b/i.test(t) && !/\b(no\s+(se|s[eé])\b)/i.test(t)) {
    if (!/^(s[ií]|yes)/i.test(t)) return false;
  }
  const word = publish ? /(publ[ií]ca|publicar|publish|ponla en l[ií]nea|s[uú]bela|go live)/i : /(despubl|quita(la)? de (internet|l[ií]nea)|borrador|unpublish|take (it )?down|oc[uú]ltala)/i;
  if (word.test(t)) return true;
  const asked = publish ? /(publ[ií]c|publish)/i.test(lastAssistant) : /(borrador|despubl|unpublish|draft)/i.test(lastAssistant);
  return asked && YES.test(t);
}

// The owner is upset: the reply gets short and only does what they asked.
const UPSET = /(in[uú]til|imb[eé]cil|idiota|est[uú]pid|mierda|maldit|co[nñ]o|carajo|odio|horrible|useless|stupid|idiot|damn|shit|wtf)/i;

// Policy words a page answer can't state unless the owner gave them.
const POLICY = /\b(impuestos?|tax(es)?|iva|deposito|deposit|reembolsos?|refunds?|cancelacion(es)?|cancellations?|cargos? extra|recargos?|surcharges?|garantia|guarantee[sd]?|propinas?)\b/g;
const fold = (x: string) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export type StoreChatResult = { reply: string; business: BusinessRow; services: ServiceRow[] };

function pageState(b: BusinessRow, services: ServiceRow[], extra: { alertsOn?: boolean } = {}) {
  const priced = services.filter((s) => (s.price ?? "").trim()).length;
  return {
    business: { name: b.name, category: b.category, city: b.city, pitch: b.pitch, whatsapp: b.whatsapp, accentColor: b.accentColor, published: Boolean(b.published) },
    brainPlan: b.plan.service ? { profile: { ownerName: b.plan.profile.ownerName, city: b.plan.profile.city, state: b.plan.profile.state, zip: b.plan.profile.zip, radiusMiles: b.plan.profile.radiusMiles, languages: b.plan.profile.languages, yearsExperience: b.plan.profile.yearsExperience, yearsOwnBusiness: b.plan.profile.yearsOwnBusiness, currentPrice: b.plan.profile.currentPrice }, neverWants: b.plan.profile.notWant, rejectedIdeas: b.plan.rejectedIdeas, flowLanguage: b.plan.flowLang || null, cardAnswers: b.plan.cards, service: b.plan.service, customer: b.plan.customer, problem: b.plan.problem, promise: b.plan.promise, differentiators: b.plan.differentiators, packages: b.plan.packages, offer: b.plan.offer, photoIdeas: b.plan.photoIdeas, videoScript: b.plan.videoScript ? "ready" : "" } : null,
    page: b.site,
    services: services.map((s) => ({ id: s.id, name: s.name, price: s.price, description: s.description, featured: Boolean(s.featured), tag: s.tag ?? null })),
    missing: missingForSales({ category: b.category, whatsapp: b.whatsapp, site: b.site, serviceCount: services.length, pricedServices: priced }).filter((m) => !b.site.declined.some((d) => m.toLowerCase().includes(d))),
    // Facts to never get wrong: what's on, what's done, what they said no to.
    published: Boolean(b.published),
    alertsOn: Boolean(extra.alertsOn),
    ownerDeclined: b.site.declined,
    layout: { galleryCards: b.site.galleryCards, hiddenSections: b.site.hidden },
    realPhotos: [b.site.coverUrl, ...b.site.gallery].filter(Boolean).length,
    hasVideo: Boolean(b.site.videoUrl),
    languages: b.plan.profile.languages || (b.site.spanish ? "es" : ""),
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

// What save_service writes. A new service gets every field (empty = none).
// Updating one changes only the fields that were sent (undefined = keep), so
// "change the price" never wipes its description, featured mark or tag; an
// explicit empty price or description clears it.
export function serviceFields(
  input: Record<string, unknown>,
  isUpdate: boolean
): { name?: string; price?: string | null; description?: string | null; featured?: boolean; tag?: string | null } {
  const sent = (k: string) => input[k] !== undefined && input[k] !== null;
  const name = clip(input.name, LIMITS.serviceName);
  if (!isUpdate) {
    const featured = Boolean(input.featured);
    return {
      name,
      price: clip(input.price, LIMITS.servicePrice) || null,
      description: clip(input.description, LIMITS.serviceDescription) || null,
      featured,
      tag: featured ? clip(input.tag, 30) || null : null,
    };
  }
  const featured = sent("featured") ? Boolean(input.featured) : undefined;
  return {
    name: name || undefined,
    price: sent("price") ? clip(input.price, LIMITS.servicePrice) || null : undefined,
    description: sent("description") ? clip(input.description, LIMITS.serviceDescription) || null : undefined,
    featured,
    tag: featured === false ? null : sent("tag") ? clip(input.tag, 30) || null : undefined,
  };
}

async function runTool(
  name: string,
  input: Record<string, unknown>,
  ctx: { business: BusinessRow; services: ServiceRow[]; canPublish: boolean; ownerSaid?: string; ownerLast?: string; lastAssistant?: string }
): Promise<string> {
  const b = ctx.business;
  switch (name) {
    case "update_page": {
      // An FAQ answer that states a policy (tax, deposit, refund…) nobody
      // approved doesn't go on the page.
      const dropped: string[] = [];
      if (Array.isArray(input.faq)) {
        const approved = fold(`${JSON.stringify(b.plan.faq)} ${JSON.stringify(b.site.faq)} ${b.plan.pricingNote} ${b.plan.offer?.detail ?? ""} ${ctx.ownerSaid ?? ""}`);
        input.faq = (input.faq as { q?: unknown; a?: unknown }[]).filter((f) => {
          const text = `${f?.q ?? ""} ${f?.a ?? ""}`;
          const terms = [...fold(text).matchAll(POLICY)].map((m) => m[0]);
          const unapproved = terms.filter((t) => !approved.includes(t));
          if (unapproved.length) dropped.push(String(f?.q ?? "").slice(0, 80));
          return unapproved.length === 0;
        });
      }
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
          // A ZIP is kept, so the page and the panel show exactly where they are.
          const zip = /\b(\d{5})\b/.exec(String(input.reachCity ?? ""))?.[1];
          if (where && zip) patch.baseZip = zip;
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
            parseServiceAgent({
              ...b.serviceAgent,
              welcomePercent: pct,
              welcomeOn: /\b(mes|mensual|month|monthly)\b/i.test(text) ? "monthly" : "all",
              // Only the package the offer names, if it names one.
              welcomeOffer: offerTarget(text, b.serviceAgent.offers.map((x) => ({ id: x.id, name: x.title }))),
            })
          );
          notes.push(pct ? `the agent's checkout now takes ${pct}% off a new customer's first purchase` : "the agent's welcome discount was removed");
        }
      }
      if (dropped.length) notes.push(`FAQ not saved: ${dropped.map((q) => `"${q}"`).join(", ")} — it states a tax, fee, deposit, refund or other policy the owner never gave. Ask the owner first; only add it with their own words`);
      const problems = notes.filter((n) => !n.startsWith("the agent's"));
      const info = notes.filter((n) => n.startsWith("the agent's"));
      return `${problems.length ? `saved, with problems: ${problems.join("; ")}` : "saved"}${info.length ? `; ${info.join("; ")}` : ""}`;
    }
    case "save_service": {
      const isUpdate = typeof input.id === "string" && Boolean(input.id);
      const f = serviceFields(input, isUpdate);
      const nameV = f.name ?? "";
      let price = f.price;
      // A market reference from the Brain (ref) is never shown as the owner's
      // price: it goes on the page only once the owner said that amount (or
      // said yes when asked about it). An existing service keeps its price.
      let refNote = "";
      if (price && refPriceUnconfirmed(price, b.plan.packages, { ...ctx, yes: YES.test(ctx.ownerLast ?? "") })) {
        refNote = `; ${isUpdate ? "its price was NOT changed" : "saved WITHOUT a price"}: ${price} is the Brain's market reference, not the owner's price. Ask the owner what they charge (one question) and save their answer`;
        price = isUpdate ? undefined : null;
      }
      const { description, featured, tag } = f;
      if (!nameV && !isUpdate) return "error: name required";
      if (isUpdate) {
        if (!ctx.services.some((s) => s.id === input.id)) return "error: unknown service id";
        // Only what the AI sent changes: a new price never erases the
        // description (or the other way round), nor the featured mark.
        await updateService(input.id as string, { name: nameV || undefined, price, description, featured, tag });
      } else {
        if (ctx.services.length >= 30) return "error: too many services";
        await addService(b.id, nameV, price ?? undefined, description ?? undefined, ctx.services.length);
        const fresh = await listServices(b.id);
        const created = fresh[fresh.length - 1];
        if (created && (featured || tag)) await updateService(created.id, { featured, tag });
      }
      return `saved${refNote}`;
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
      // A screenshot (or anything that isn't a photo for the page) never stays on it.
      if (input.whatItIs === "screenshot" || input.whatItIs === "other") {
        await mergeBusinessSite(b.id, cur, {
          gallery: cur.gallery.filter((g) => g !== url),
          coverUrl: cur.coverUrl === url ? "" : cur.coverUrl,
          logoUrl: cur.logoUrl === url ? "" : cur.logoUrl,
          ownerPhotoUrl: cur.ownerPhotoUrl === url ? "" : cur.ownerPhotoUrl,
        });
        return "it's not a photo for the page, so it's not on it (removed if it was). Answer the owner about what the image shows; if it's a screenshot of their page, talk about what they point at and fix it with your tools.";
      }
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
      // Say exactly where it is now, so the reply never invents rules about photos.
      return `saved. Now: main photo = ${site.coverUrl === url ? "this one" : site.coverUrl ? "another photo" : "none"}; gallery = ${site.gallery.length} photo(s)${site.gallery.includes(url) ? " including this one" : ""}; owner's chat photo = ${ownerPhotoUrl === url ? "this one" : ownerPhotoUrl ? "another photo" : "none"}. The main photo also shows first in the gallery on the page.`;
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
      if (typeof input.welcomeOffer === "string") next.welcomeOffer = input.welcomeOffer;
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
    case "set_layout": {
      const cur = (await getBusinessById(b.id))?.site ?? b.site;
      const patch: Partial<SiteData> = {};
      const done: string[] = [];
      if (input.galleryCards === "auto" || input.galleryCards === "on" || input.galleryCards === "off") {
        patch.galleryCards = input.galleryCards;
        done.push(`price/offer cards in the gallery: ${input.galleryCards}`);
      }
      const valid = (v: unknown) => (Array.isArray(v) ? v : []).filter((x): x is PageSection => (PAGE_SECTIONS as readonly string[]).includes(String(x)));
      const parts = (v: unknown) => (Array.isArray(v) ? v : []).filter((x): x is Hideable => (HIDEABLE as readonly string[]).includes(String(x)));
      const hide = parts(input.hide);
      const show = parts(input.show);
      if (hide.length || show.length) {
        patch.hidden = [...new Set([...cur.hidden, ...hide])].filter((x) => !show.includes(x));
        done.push(`hidden sections: ${patch.hidden.join(", ") || "none"}`);
      }
      if (Array.isArray(input.order) && input.order.length) {
        patch.order = sectionOrder([...valid(input.order), ...cur.order]);
        done.push(`section order: ${patch.order.join(" > ")}`);
      }
      if (typeof input.design === "string" && (PAGE_DESIGNS as readonly string[]).includes(input.design)) {
        patch.design = input.design as PageDesign;
        done.push(`design: ${input.design}`);
      }
      if (typeof input.firstPhoto === "string" && cur.gallery.includes(input.firstPhoto)) {
        patch.gallery = [input.firstPhoto, ...cur.gallery.filter((g) => g !== input.firstPhoto)];
        done.push("that photo is first in the gallery now");
      }
      if (Array.isArray(input.declined) && input.declined.length) {
        patch.declined = [...new Set([...cur.declined, ...input.declined.map(String)])].slice(0, 20);
        done.push(`won't suggest again: ${patch.declined.join(", ")}`);
      }
      if (!done.length) return "nothing to change";
      await mergeBusinessSite(b.id, cur, patch);
      return `saved: ${done.join("; ")}`;
    }
    case "publish_page": {
      // Publishing (or taking the page down) needs the owner's explicit OK in
      // this very message: "publícala", or a yes right after you asked.
      if (!publishConsent(Boolean(input.publish), ctx.ownerLast ?? "", ctx.lastAssistant ?? ""))
        return "not done: the owner didn't explicitly ask for this in their last message. Nothing changed. Don't ask again unless they bring it up.";
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
  // Which panel area this chat is: Store (the sales page) or Agente (the agent itself).
  area?: "store" | "agent";
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
  // What the owner wrote in this chat (a policy on the page must come from them).
  const ownerSaid = [...opts.history.filter((h) => h.role === "user").map((h) => h.content), opts.message].join("\n");
  const BLOB = /https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\/[^\s"')]+/gi;
  const recent = [opts.message, ...opts.history.filter((h) => h.role === "user").map((h) => h.content).reverse()]
    .flatMap((t) => t.match(BLOB) ?? [])
    // Only photos go to the model as images (a video link would make it fail).
    .filter((u) => !/\/video-|\.(mp4|mov|m4v|webm|qt)(\?|$)/i.test(u));
  const newUploads = opts.message.match(BLOB) ?? [];
  const justUploaded = newUploads.length > 0;
  // Images go to the model only when they matter: a new upload, or the owner
  // talking about a photo or a screenshot. Old photos aren't re-described.
  const aboutPhotos = /(foto|imagen|captura|pantallazo|screenshot|picture|photo|image)/i.test(opts.message);
  const photos = justUploaded ? [...new Set(recent)].slice(0, 1) : aboutPhotos ? [...new Set(recent)].slice(0, 2) : [];
  const alertsOn = await listPushSubs(business.userId).then((x) => x.length > 0).catch(() => false);
  const lastAssistant = [...opts.history].reverse().find((h) => h.role === "assistant")?.content ?? "";
  const upset = UPSET.test(opts.message);
  const isAgentProject = business.plan.mode === "agent" || Boolean(business.serviceAgent.name);
  const areaNote =
    opts.area === "agent"
      ? `\n\nTHIS CHAT IS THE AGENT AREA (in the panel, right below Store). Here the owner sets up the AI agent itself: its name, what it does end to end (set_agent_task), its method (instructions), limits, greeting, knowledge, access offers, on/off — and how its chat looks to customers: a full-screen conversation with the agent's name and identity, always in Sevrii's black, white and green. The sales page (headline, texts, key points, photos, video, FAQ, publishing) is set up in Store: if they ask for page changes here, say in one line that it's done in Store and don't change the page.`
      : isAgentProject
        ? `\n\nTHIS CHAT IS STORE: the sales page. The agent itself (what it does, its method, limits, greeting, knowledge, on/off) is set up in the Agente area, right below Store in the panel: if the owner asks here to change the agent, say in one line that it's done in Agente and don't change it. Access offers and prices can be changed here too.`
        : "";
  const system = `${SYSTEM}${areaNote}\n\nReply in ${es ? "Spanish (neutral, 'tú')" : "English"}. Page text goes in the page's language (page.lang) unless the owner asks otherwise.`;
  const messages: MessageParam[] = [
    ...opts.history.map((h): MessageParam => ({ role: h.role, content: h.content })),
    {
      role: "user",
      content: [
        ...photos.map((url) => ({ type: "image" as const, source: { type: "url" as const, url } })),
        {
          type: "text" as const,
          text: `${photos.length ? `Attached: the owner's latest uploaded photo${photos.length > 1 ? "s, newest first" : ""} (${photos.join(" , ")}).${justUploaded ? " The first one was JUST uploaded: describe it in a few words and decide where it goes." : ""}\n\n` : ""}Page state (JSON):\n${JSON.stringify(pageState(business, services, { alertsOn }))}\n\nOwner: ${opts.message}${upset ? "\n\n(Internal note: the owner is upset. Reply in 1-3 short sentences: do or answer exactly what they asked, with your tools if needed. No apologies list, no repeating the page status, no suggestions.)" : ""}`,
        },
      ],
    },
  ];

  let reply = "";
  const classified = new Set<string>();
  const wasPublished = Boolean(business.published);
  try {
    for (let step = 0; step < 7; step++) {
      const res = await client.messages.create({
        model: MODEL,
        max_tokens: 6000,
        thinking: { type: "between_tools" },
        // Medium: it thinks about what the owner really asked and does it.
        output_config: { effort: "medium" },
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
      if (res.stop_reason !== "tool_use" || uses.length === 0) {
        // A new upload must be classified (a screenshot never stays on the page).
        const pending = newUploads.filter((u) => !classified.has(u) && !/\/video-|\.(mp4|mov|m4v|webm|qt)(\?|$)/i.test(u));
        if (pending.length && step < 5) {
          if (res.content.length) messages.push({ role: "assistant", content: res.content.filter((c) => c.type !== "tool_use") });
          messages.push({ role: "user", content: `(System: classify the image just uploaded with set_photo — whatItIs and role — before replying: ${pending.join(" , ")}. A screenshot never goes on the page.)` });
          classified.add(pending[0]);
          continue;
        }
        break;
      }

      const results: ToolResultBlockParam[] = [];
      for (const u of uses) {
        let out: string;
        try {
          out = await runTool(u.name, (u.input ?? {}) as Record<string, unknown>, { business, services, canPublish: opts.canPublish, ownerSaid, ownerLast: opts.message, lastAssistant });
          if (u.name === "set_photo") classified.add(String((u.input as Record<string, unknown>)?.url ?? ""));
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
        content: [...results, { type: "text", text: `Updated page state (JSON):\n${JSON.stringify(pageState(business, services, { alertsOn }))}` }],
      });
    }
  } catch (err) {
    logAiError("store", err);
    reply = aiErrorReply(err, opts.lang === "en" ? "en" : "es");
  }

  reply = cleanStoreReply(reply, business, { alertsOn, upset, message: opts.message });
  // The next step is a button, not "búscalo en el menú": after publishing, or
  // when the owner asks about Marketing, Payments or their chats.
  const go: string[] = [];
  if (!wasPublished && business.published) go.push("next");
  else if (/(marketing|anuncio|publicidad|campa[nñ]a|\bads?\b)/i.test(opts.message)) go.push("marketing");
  else if (/(pago|payments?|cobrar|stripe|link de pago)/i.test(opts.message)) go.push("payments");
  else if (/(conversaci|mensajes de clientes|chats?\b)/i.test(opts.message)) go.push("chats");
  if (go.length && !/\[\[[a-z]+(:[a-z]+)?\]\]\s*$/.test(reply)) reply = `${reply}\n\n[[go:${go[0]}]]`;
  return { reply: reply || (es ? "Listo." : "Done."), business, services };
}

// Checked in code on every Store reply: no pushing what the owner declined or
// already did, no languages they didn't give, and short when they're upset.
function cleanStoreReply(reply: string, b: BusinessRow, o: { alertsOn: boolean; upset: boolean; message: string }): string {
  if (!reply) return reply;
  const declined = new Set(b.site.declined);
  const asked = (r: RegExp) => r.test(o.message);
  const drop: RegExp[] = [];
  // Only when the owner didn't bring the topic up themselves in this message.
  const VIDEO = /\bv[ií]deo\b/i;
  const ALERTS = /\b(avisos|alertas|notificaci|alerts|notifications)/i;
  const PUBLISH = /\bpublic|\bpublish/i;
  const REVIEWS = /(rese[nñ]as|reviews)/i;
  if ((declined.has("video") || b.site.videoUrl) && !asked(VIDEO)) drop.push(VIDEO);
  if ((o.alertsOn || declined.has("alerts")) && !asked(ALERTS)) drop.push(ALERTS);
  if ((b.published || declined.has("publish")) && !asked(PUBLISH)) drop.push(/(¿[^?]*publi[cq]|publicar(la)? ahora|shall i publish|publish it now)/i);
  if (declined.has("reviews") && !asked(REVIEWS)) drop.push(REVIEWS);
  // Never claim a language the owner didn't give.
  const langs = b.plan.profile.languages || (b.site.spanish ? "es" : "");
  if (langs === "es") drop.push(/(atiend|habl|serv|attend|speak)\w*[^.?!]{0,40}(ingl[eé]s|english)|biling[uü]e|bilingual/i);
  if (langs === "en") drop.push(/(atiend|habl|serv|attend|speak)\w*[^.?!]{0,40}(espa[nñ]ol|spanish)|biling[uü]e|bilingual/i);
  let parts = reply.split(/(?<=[.!?])\s+|\n+/).filter((x) => x.trim());
  const kept = parts.filter((x) => !drop.some((r) => r.test(x)));
  if (kept.length) parts = kept;
  // Upset owner: at most 3 sentences, no closing sales question.
  if (o.upset) parts = parts.slice(0, 3);
  return parts.join(" ").replace(/\s{2,}/g, " ").trim();
}

// First message of the Agente area (no AI call needed).
export function agentAreaGreeting(lang: Lang, b: BusinessRow): string {
  const es = lang === "es";
  const name = b.serviceAgent.name;
  return es
    ? `Aquí configuras ${name ? `a "${name}"` : "tu agente"}: lo que hace de punta a punta, su método, sus límites, su saludo, lo que sabe y cómo se ve su chat para tus clientes. Aquí al lado tienes su estado y cómo lo ven. ¿Qué quieres cambiar?`
    : `Here you set up ${name ? `"${name}"` : "your agent"}: what it does end to end, its method, its limits, its greeting, what it knows and how its chat looks to your customers. Its status and how customers see it are right here. What do you want to change?`;
}

// First message when the chat is empty — no AI call needed.
export function storeGreeting(lang: Lang, b: BusinessRow, serviceCount: number): string {
  const es = lang === "es";
  if (b.plan.mode === "agent" && b.serviceAgent.name && !b.serviceAgent.enabled) {
    return es
      ? `¡Hola! Ya armé el primer borrador de tu agente, "${b.serviceAgent.name}", con tu estrategia del Cerebro. Para que trabaje bien necesita tu conocimiento: pégame aquí tus apuntes, reglas o respuestas a las preguntas que más te hacen, y lo dejo listo para probarlo.`
      : `Hi! I built the first draft of your agent, "${b.serviceAgent.name}", from your Brain strategy. To work well it needs your knowledge: paste your notes, rules or answers to the questions you get most, and I'll get it ready to test.`;
  }
  // This chat has no tool to rebuild the page from the plan: the button above
  // the preview does it, so the greeting points there (never "¿La armo así?").
  if (planReadyForStore(b.plan) && b.site.fromPlan !== planFingerprint(b.plan)) {
    return es
      ? `¡Hola! Ya tengo la estrategia que aprobaste en el Cerebro para "${b.plan.service}". Toca «${b.site.fromPlan ? "Actualizar mi página" : "Armar mi página"}» arriba de la vista previa y la armo con eso: título, puntos clave y tus paquetes. Luego la revisamos juntos aquí.`
      : `Hi! I have the strategy you approved in the Brain for "${b.plan.service}". Tap "${b.site.fromPlan ? "Update my page" : "Build my page"}" above the preview and I'll build it from that: headline, key points and your packages. Then we review it together here.`;
  }
  if (serviceCount > 0 || b.site.headline) {
    if (b.plan.mode === "agent" && b.serviceAgent.name)
      return es
        ? `Tu agente y su página ya están armados con lo que aprobamos. A la derecha ves la página tal como está (en el teléfono, toca «Vista previa»). Aquí puedo cambiar el título, la oferta o los precios, y agregar fotos o un video. El agente se configura en «Agente», justo debajo de Store. ¿Qué quieres cambiar?`
        : `Your agent and its page are built from what we approved. On the right you see the page as it is (on a phone, tap "Preview"). Here I can change the headline, the offer or the prices, and add photos or a video. The agent itself is set up in "Agent", right below Store. What do you want to change?`;
    return es
      ? `Tu página ya está armada con lo que aprobamos. A la derecha la ves tal como está (en el teléfono, toca «Vista previa»). Aquí puedo agregar fotos o un video, cambiar el título, la oferta o los precios. ¿Qué quieres cambiar?`
      : `Your page is built from what we approved. On the right you see it as it is (on a phone, tap "Preview"). Here I can add photos or a video, change the headline, the offer or the prices. What do you want to change?`;
  }
  return es
    ? `¡Hola! Voy a armar contigo la página de ${b.name} para que más clientes te escriban. Para empezar: ¿qué servicio quieres vender y cuánto cuesta?`
    : `Hi! I'll build ${b.name}'s page with you so more customers message you. To start: what service do you want to sell, and how much does it cost?`;
}
