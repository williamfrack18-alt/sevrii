// Automatic emails: welcome (new account) and "you got paid" (Payments).
// Both are best-effort: if email isn't set up or sending fails, nothing breaks.
import { emailReady, sendEmail, simpleEmail } from "./email";
import { siteUrl } from "./billing";
import { claimPaymentNotice, getUserById, hasPaymentNotice, releasePaymentNotice, type BusinessRow } from "./db";
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
export async function notifyPaymentReceived(business: BusinessRow, sessionId: string): Promise<void> {
  if (!emailReady() || !business.stripeAccountId) return;
  try {
    if (await hasPaymentNotice(sessionId)) return;
    const paid = await getPaidSession(business, sessionId);
    if (!paid) return;
    if (!(await claimPaymentNotice(sessionId, business.id))) return;
    const owner = await getUserById(business.userId);
    if (!owner?.email) return;
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
    const ok = await sendEmail(owner.email, t.paidSubject(amt), html, text);
    // If sending failed, let a later call (webhook retry, page reload) try again.
    if (!ok) await releasePaymentNotice(sessionId);
  } catch (err) {
    console.error("[notify] payment notice failed", (err as Error)?.message);
  }
}
