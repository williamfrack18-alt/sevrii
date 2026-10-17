// Automatic emails: welcome (new account) and "you got paid" (Payments).
// Both are best-effort: if email isn't set up or sending fails, nothing breaks.
import { emailReady, sendEmail, simpleEmail } from "./email";
import { siteUrl } from "./billing";
import { claimPaymentNotice, getUserById, hasPaymentNotice, releasePaymentNotice, type BusinessRow, type CampaignStats, type ConversationRow } from "./db";
import { getPaidSession } from "./payments";

type Lang = "es" | "en";

function money(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

const TEXT = {
  es: {
    welcomeSubject: "Bienvenido a Sevrii",
    welcomeTitle: "¡Bienvenido a Sevrii!",
    welcomeIntro: "Tu cuenta ya está lista. En pocos minutos puedes tener tu negocio en línea y empezar a recibir clientes. Así de fácil:",
    welcomeItems: [
      "1. Cuéntanos de tu negocio y armamos tu página por ti.",
      "2. Agrega tus servicios, precios y fotos.",
      "3. Activa Pagos y cobra con tarjeta desde un link.",
      "4. Comparte tu página por WhatsApp y redes sociales.",
    ],
    welcomeButton: "Ir a mi panel",
    welcomeOutro: "¿Tienes preguntas? Responde a este correo y te ayudamos.",
    paidSubject: (amt: string) => `Recibiste un pago de ${amt}`,
    paidTitle: "¡Recibiste un pago!",
    paidIntro: (who: string, title: string) => `${who} te pagó por "${title}" con tu link de Sevrii.`,
    someone: "Un cliente",
    amount: "Monto",
    fees: "Comisiones (Stripe + Sevrii)",
    net: "Recibes aprox.",
    client: "Cliente",
    paidButton: "Ver mis pagos",
    paidOutro:
      "Stripe deposita el dinero en tu cuenta bancaria según tu calendario de pagos (normalmente en 2 días hábiles; el primer depósito puede tardar un poco más).",
  },
  en: {
    welcomeSubject: "Welcome to Sevrii",
    welcomeTitle: "Welcome to Sevrii!",
    welcomeIntro: "Your account is ready. In a few minutes you can have your business online and start getting clients. It's this easy:",
    welcomeItems: [
      "1. Tell us about your business and we'll build your page for you.",
      "2. Add your services, prices and photos.",
      "3. Turn on Payments and get paid by card with a link.",
      "4. Share your page on WhatsApp and social media.",
    ],
    welcomeButton: "Go to my dashboard",
    welcomeOutro: "Questions? Just reply to this email and we'll help you.",
    paidSubject: (amt: string) => `You received a payment of ${amt}`,
    paidTitle: "You got paid!",
    paidIntro: (who: string, title: string) => `${who} paid you for "${title}" with your Sevrii link.`,
    someone: "A client",
    amount: "Amount",
    fees: "Fees (Stripe + Sevrii)",
    net: "You get approx.",
    client: "Client",
    paidButton: "See my payments",
    paidOutro:
      "Stripe sends the money to your bank account on your payout schedule (usually within 2 business days; the first payout can take a little longer).",
  },
};

export async function sendWelcomeEmail(email: string, lang: Lang): Promise<void> {
  if (!emailReady()) return;
  try {
    const t = TEXT[lang];
    const { html, text } = simpleEmail({
      title: t.welcomeTitle,
      intro: t.welcomeIntro,
      items: t.welcomeItems,
      button: t.welcomeButton,
      url: `${siteUrl()}/dashboard`,
      outro: t.welcomeOutro,
    });
    await sendEmail(email, t.welcomeSubject, html, text);
  } catch (err) {
    console.error("[notify] welcome failed", (err as Error)?.message);
  }
}

// Emails the business owner once per paid Checkout session. Safe to call many
// times (the pay page and the Stripe webhook may both call it).
// Returns false only when it should be tried again (Stripe couldn't be read or
// the email didn't go out); true when sent, already sent, or nothing to send.
export async function notifyPaymentReceived(business: BusinessRow, sessionId: string): Promise<boolean> {
  if (!emailReady() || !business.stripeAccountId) return true;
  let claimed = false;
  try {
    if (await hasPaymentNotice(sessionId)) return true;
    const paid = await getPaidSession(business, sessionId, { throwOnError: true });
    if (!paid) return true;
    if (!(await claimPaymentNotice(sessionId, business.id))) return true;
    claimed = true;
    const owner = await getUserById(business.userId);
    if (!owner?.email) return true;
    const t = TEXT[business.site.lang === "en" ? "en" : "es"];
    const amt = money(paid.amountCents);
    const who = paid.name || paid.email || t.someone;
    const client = [paid.name, paid.email].filter(Boolean).join(" · ");
    const items = [
      `${t.amount}: ${amt}`,
      `${t.fees}: −${money(paid.feeCents)}`,
      `${t.net}: ${money(Math.max(0, paid.amountCents - paid.feeCents))}`,
      ...(client ? [`${t.client}: ${client}`] : []),
    ];
    const { html, text } = simpleEmail({
      title: t.paidTitle,
      highlight: amt,
      intro: t.paidIntro(who, paid.title || business.name),
      items,
      button: t.paidButton,
      url: `${siteUrl()}/dashboard?view=payments`,
      outro: t.paidOutro,
    });
    if (await sendEmail(owner.email, t.paidSubject(amt), html, text)) return true;
    console.error("[notify] payment notice not sent", sessionId);
  } catch (err) {
    console.error("[notify] payment notice failed", (err as Error)?.message);
  }
  // Failed: free the claim so a later call (webhook retry, page reload) can send it.
  if (claimed) {
    try {
      await releasePaymentNotice(sessionId);
    } catch (err) {
      console.error("[notify] could not release payment notice", sessionId, (err as Error)?.message);
    }
  }
  return false;
}

// Visitor text can't carry clickable links into an email sent from Sevrii.
// Owner text sent to a customer: links only to Sevrii pages (pay links, the
// owner's page) survive; anything else becomes [link].
function keepSevriiLinks(s: string): string {
  const keep: string[] = [];
  const marked = s.replace(/\bhttps:\/\/(?:www\.)?sevrii\.com\/[^\s<>"']*/gi, (m) => `\u0000${keep.push(m) - 1}\u0000`);
  return defang(marked).replace(/\u0000(\d+)\u0000/g, (_, i) => keep[Number(i)] ?? "");
}

export function defang(s: string): string {
  return s
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, "[link]")
    .replace(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|co|xyz|info|biz|app|link|site|top|ru|cn)\b\S*/gi, "[link]");
}

// The owner gets an email when a chat needs them (throttled by the caller).
export async function notifyChatOwner(business: BusinessRow, conv: ConversationRow, why: "contact" | "handoff" | "message", detail: string): Promise<void> {
  if (!emailReady()) return;
  try {
    const owner = await getUserById(business.userId);
    if (!owner?.email) return;
    const es = business.site.lang !== "en";
    const who = conv.name ? defang(conv.name) : es ? "Un cliente" : "A customer";
    const items = [
      ...(conv.name ? [`${es ? "Nombre" : "Name"}: ${defang(conv.name)}`] : []),
      ...(conv.phone ? [`${es ? "Teléfono" : "Phone"}: ${conv.phone}`] : []),
      ...(conv.email ? [`Email: ${conv.email}`] : []),
      ...(detail ? [`${why === "handoff" ? (es ? "Lo que quiere" : "What they want") : es ? "Último mensaje" : "Last message"}: ${defang(detail)}`] : []),
    ];
    const title =
      why === "handoff"
        ? es ? "Un cliente quiere que lo atiendas" : "A customer wants you to follow up"
        : why === "contact"
          ? es ? "Nuevo cliente en tu chat" : "New customer in your chat"
          : es ? "Nuevo mensaje en tu chat" : "New message in your chat";
    const { html, text } = simpleEmail({
      title,
      intro: es
        ? `${who} escribió en el chat de tu página de ${business.name}. Responde rápido: quien contesta primero se queda con el cliente.`
        : `${who} wrote in the chat on your ${business.name} page. Reply fast: whoever answers first usually gets the job.`,
      items,
      button: es ? "Abrir la conversación" : "Open the conversation",
      url: `${siteUrl()}/dashboard?view=chats&c=${conv.id}`,
      outro: es
        ? "Puedes contestar desde Sevrii, o llamarlo o escribirle directo al número que dejó."
        : "You can answer in Sevrii, or call or text the number they left.",
    });
    await sendEmail(owner.email, `${title}${conv.name ? ` · ${defang(conv.name)}` : ""}`, html, text, conv.email || owner.email);
  } catch (err) {
    console.error("[notify] chat owner failed", (err as Error)?.message);
  }
}

// The owner answered after the visitor left the page: send it to their email.
export async function emailVisitorReply(business: BusinessRow, conv: ConversationRow, message: string): Promise<void> {
  if (!emailReady() || !conv.email) return;
  try {
    const owner = await getUserById(business.userId);
    const es = business.site.lang !== "en";
    const who = business.site.ownerName ? (es ? `${business.site.ownerName}, de ${business.name},` : `${business.site.ownerName} from ${business.name}`) : business.name;
    // The address was typed by the visitor (not verified): no links in the
    // owner's text, and the email says plainly who wrote it and that Sevrii
    // never asks for passwords or card numbers.
    const { html, text } = simpleEmail({
      title: es ? `${who} te respondió` : `${who} replied`,
      intro: keepSevriiLinks(message).slice(0, 2000),
      button: es ? "Seguir la conversación" : "Continue the conversation",
      url: `${siteUrl()}/site/${business.slug}?chat=1`,
      outro: es
        ? `Recibes esto porque dejaste este correo en el chat de ${business.name} en Sevrii. También puedes responder este correo. Sevrii nunca te pedirá contraseñas ni datos de tarjeta por correo.`
        : `You're getting this because you left this email in the ${business.name} chat on Sevrii. You can also reply to this email. Sevrii will never ask for passwords or card details by email.`,
    });
    const from = business.site.ownerName ? `${business.site.ownerName} (${business.name})` : business.name;
    await sendEmail(conv.email, es ? `Respuesta de ${from} · vía Sevrii` : `Reply from ${from} · via Sevrii`, html, text, owner?.email || undefined);
  } catch (err) {
    console.error("[notify] visitor reply failed", (err as Error)?.message);
  }
}

// ---------- Weekly summary (Monday email to the owner) ----------

export type WeeklyNumbers = { chats: number; contacts: number };
export type WeeklyCampaign = { title: string; week: CampaignStats; prev: CampaignStats };
export type WeeklySummary = {
  week: WeeklyNumbers; // last 7 days
  prev: WeeklyNumbers; // the 7 days before
  campaigns: WeeklyCampaign[]; // campaigns with activity in the last 14 days
  campaignCount: number; // all campaigns of the business
};

// 1–3 short tips from simple rules (no AI).
export function weeklyTips(d: WeeklySummary, lang: Lang): string[] {
  const es = lang === "es";
  const tips: string[] = [];
  if (d.week.chats === 0) {
    tips.push(
      es
        ? "Nadie escribió esta semana: suma tu video o una oferta de bienvenida a tu página."
        : "No one wrote this week: add your video or a welcome offer to your page."
    );
  } else if (d.week.contacts === 0) {
    tips.push(
      es
        ? "Te escribieron pero nadie dejó su teléfono: pide el teléfono antes en la conversación."
        : "People wrote but no one left a phone number: ask for the phone number earlier in the chat."
    );
  }
  const weak = d.campaigns.find((c) => c.week.views >= 10 && c.week.chats === 0);
  if (weak) {
    const name = defang(weak.title).slice(0, 60);
    tips.push(
      es
        ? `"${name}" trae visitas pero nadie escribe: cambia la imagen o el texto de ese anuncio.`
        : `"${name}" brings visits but no one writes: change the image or the text of that ad.`
    );
  }
  if (d.campaignCount === 0) {
    tips.push(es ? "Lanza tu primera campaña en Marketing: Sevrii te la deja lista." : "Launch your first campaign in Marketing: Sevrii gets it ready for you.");
  }
  if (tips.length === 0) {
    tips.push(es ? "Vas bien: responde cada chat rápido, quien contesta primero se queda con el cliente." : "Going well: answer every chat fast, whoever replies first usually gets the job.");
  }
  return tips.slice(0, 3);
}

function trend(now: number, before: number, es: boolean): string {
  if (now === before) return es ? "igual que la semana pasada" : "same as last week";
  const diff = now - before;
  return es ? `${diff > 0 ? "+" : "−"}${Math.abs(diff)} vs. la semana pasada` : `${diff > 0 ? "+" : "−"}${Math.abs(diff)} vs. last week`;
}

// Sends the weekly summary. Every value goes through simpleEmail, which
// escapes it; owner/AI-written titles are also defanged (no links).
export async function sendWeeklySummary(business: BusinessRow, ownerEmail: string, d: WeeklySummary): Promise<boolean> {
  if (!emailReady() || !ownerEmail) return false;
  try {
    const lang: Lang = business.site.lang === "en" ? "en" : "es";
    const es = lang === "es";
    const name = defang(business.name).slice(0, 80);
    const items = [
      `${es ? "Chats" : "Chats"}: ${d.week.chats} (${trend(d.week.chats, d.prev.chats, es)})`,
      `${es ? "Contactos (teléfono o correo)" : "Contacts (phone or email)"}: ${d.week.contacts} (${trend(d.week.contacts, d.prev.contacts, es)})`,
      ...d.campaigns.slice(0, 5).map((c) => {
        const w = c.week;
        const title = defang(c.title).slice(0, 60);
        return es
          ? `${title}: ${w.views} visitas · ${w.chats} chats · ${w.contacts} contactos`
          : `${title}: ${w.views} visits · ${w.chats} chats · ${w.contacts} contacts`;
      }),
      ...weeklyTips(d, lang).map((tip) => `${es ? "Consejo" : "Tip"}: ${tip}`),
    ];
    const { html, text } = simpleEmail({
      title: es ? `Tu semana en ${name}` : `Your week at ${name}`,
      highlight: es
        ? `${d.week.contacts} ${d.week.contacts === 1 ? "contacto" : "contactos"}`
        : `${d.week.contacts} ${d.week.contacts === 1 ? "contact" : "contacts"}`,
      intro: es
        ? "Esto es lo que trajo tu página en los últimos 7 días, comparado con la semana anterior."
        : "Here's what your page brought in the last 7 days, compared with the week before.",
      items,
      button: es ? "Ver mis resultados" : "See my results",
      url: `${siteUrl()}/dashboard?view=marketing`,
      outro: es
        ? "Recibes este resumen una vez por semana. Puedes apagar los correos de avisos en tu panel."
        : "You get this summary once a week. You can turn off email alerts in your dashboard.",
    });
    const subject = es ? `Tu semana: ${d.week.chats} chats, ${d.week.contacts} contactos · ${name}` : `Your week: ${d.week.chats} chats, ${d.week.contacts} contacts · ${name}`;
    return await sendEmail(ownerEmail, subject, html, text);
  } catch (err) {
    console.error("[notify] weekly summary failed", (err as Error)?.message);
    return false;
  }
}
