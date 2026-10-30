// Automatic emails: welcome (new account) and "you got paid" (Payments).
// Both are best-effort: if email isn't set up or sending fails, nothing breaks.
import { emailReady, sendEmail, simpleEmail } from "./email";
import { siteUrl } from "./billing";
import { claimPaymentNotice, getUserById, hasPaymentNotice, releasePaymentNotice, type BusinessRow, type ConversationRow } from "./db";
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

// A short alert to Sevrii's admins (SEVRII_ADMIN_EMAILS), e.g. the AI credit is
// about to run out. Best-effort: never throws.
export async function notifyAdmins(subject: string, text: string): Promise<void> {
  try {
    const to = (process.env.SEVRII_ADMIN_EMAILS || "").split(",").map((e) => e.trim()).filter(Boolean);
    if (!to.length || !emailReady()) {
      console.warn("[admin-alert]", subject, text);
      return;
    }
    const html = `<p>${text.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c] as string).replace(/\n/g, "<br>")}</p>`;
    for (const addr of to) await sendEmail(addr, subject, html, text);
  } catch (err) {
    console.error("[admin-alert] failed", err);
  }
}

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
    const t = TEXT[owner.lang === "en" || owner.lang === "es" ? owner.lang : business.site.lang === "en" ? "en" : "es"];
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
    // The owner reads it: their language, not the page's.
    const es = owner.lang === "es" || owner.lang === "en" ? owner.lang === "es" : business.site.lang !== "en";
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
