import type { Metadata } from "next";
import { after } from "next/server";
import { allow, clientIp } from "@/lib/guard";
import { notifyPaymentReceived } from "@/lib/notify";
import { getBusinessById, getPaymentLink } from "@/lib/db";
import { paySessionState } from "@/lib/payments";
import { payAction } from "./actions";
import "./pay.css";

const TEXT = {
  es: {
    title: "Pagar",
    secure: "Pago seguro con tarjeta, Apple Pay o Google Pay. Procesado por Stripe.",
    pay: (amt: string) => `Pagar ${amt}`,
    paidTitle: "¡Pago recibido!",
    paidText: (biz: string) => `Gracias. ${biz} ya recibió tu pago. Stripe te envió el recibo a tu correo.`,
    payAgain: "Volver",
    processingTitle: "Tu pago se está procesando",
    processingText: (biz: string) => `Stripe está confirmando tu pago. Te llegará el recibo a tu correo cuando se complete, y ${biz} recibirá el aviso.`,
    offTitle: "Este link de pago no está disponible",
    offText: "Puede que el negocio lo haya desactivado. Escríbele directamente para pagar.",
    error: "No pudimos abrir el pago. Inténtalo de nuevo en un momento.",
    rate: "Demasiados intentos. Espera unos minutos e inténtalo de nuevo.",
    by: "Pagos con",
  },
  en: {
    title: "Pay",
    secure: "Secure payment by card, Apple Pay or Google Pay. Processed by Stripe.",
    pay: (amt: string) => `Pay ${amt}`,
    paidTitle: "Payment received!",
    paidText: (biz: string) => `Thank you. ${biz} has received your payment. Stripe emailed you the receipt.`,
    payAgain: "Back",
    processingTitle: "Your payment is processing",
    processingText: (biz: string) => `Stripe is confirming your payment. You'll get the receipt by email once it's done, and ${biz} will be notified.`,
    offTitle: "This payment link isn't available",
    offText: "The business may have turned it off. Contact them directly to pay.",
    error: "We couldn't open the payment. Please try again in a moment.",
    rate: "Too many attempts. Please wait a few minutes and try again.",
    by: "Payments by",
  },
};

function money(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function accentOf(hex: string): string {
  return /^#[0-9a-f]{6}$/i.test(hex) && hex.toLowerCase() !== "#122118" ? hex : "#234f36";
}

async function load(id: string) {
  const link = /^[a-z0-9]{6,40}$/.test(id) ? await getPaymentLink(id) : undefined;
  const business = link ? await getBusinessById(link.businessId) : undefined;
  return { link, business };
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const { link, business } = await load(id);
  if (!link || !business || !link.active) return { title: "Sevrii", robots: { index: false } };
  const t = TEXT[business.site.lang];
  return {
    title: `${t.title} · ${link.title} · ${business.name}`,
    description: `${link.title} — ${money(link.amountCents)}`,
    robots: { index: false },
  };
}

export default async function PayPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ paid?: string; error?: string; s?: string }>;
}) {
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const { link, business } = await load(id);
  const lang = business?.site.lang ?? "es";
  const t = TEXT[lang];
  const available = Boolean(link && business && link.active && business.payStatus === "ready");
  const accent = accentOf(business?.accentColor || "");
  const logo = business?.site.logoUrl || "";

  // Back from Stripe: "received" only when Stripe confirms this payment for
  // this link. Then email the owner (once per payment).
  const sessionId = String(sp.s || "");
  let state: "paid" | "processing" | null = null;
  if (sp.paid === "1" && business && link && /^cs_(live|test)_[A-Za-z0-9]{10,200}$/.test(sessionId)) {
    if (await allow(`paynotice:ip:${await clientIp()}`, 30, 60 * 60)) {
      state = await paySessionState(business, sessionId, link.id);
      if (state === "paid") {
        const biz = business;
        after(() => notifyPaymentReceived(biz, sessionId));
      }
    }
  }

  return (
    <div className="pay" lang={lang} style={{ ["--accent" as string]: accent } as React.CSSProperties}>
      <main className="pay-card">
        {business && (
          <div className="pay-biz">
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} alt="" className="pay-logo" />
            ) : (
              <span className="pay-initial">{business.name.trim().charAt(0).toUpperCase()}</span>
            )}
            <span className="pay-biz-name">{business.name}</span>
          </div>
        )}

        {state && link && business ? (
          <div className="pay-done">
            {state === "paid" && <div className="pay-check">✓</div>}
            <h1>{state === "paid" ? t.paidTitle : t.processingTitle}</h1>
            <p>{state === "paid" ? t.paidText(business.name) : t.processingText(business.name)}</p>
            <div className="pay-amount small">
              {link.title} · {money(link.amountCents)}
            </div>
          </div>
        ) : available && link ? (
          <>
            <h1 className="pay-title">{link.title}</h1>
            {link.description && <p className="pay-desc">{link.description}</p>}
            <div className="pay-amount">{money(link.amountCents)}</div>
            {sp.error && <p className="pay-error">{sp.error === "rate" ? t.rate : t.error}</p>}
            <form action={payAction}>
              <input type="hidden" name="id" value={link.id} />
              <button type="submit" className="pay-btn">
                {t.pay(money(link.amountCents))}
              </button>
            </form>
            <p className="pay-secure">🔒 {t.secure}</p>
          </>
        ) : (
          <div className="pay-done">
            <h1>{t.offTitle}</h1>
            <p>{t.offText}</p>
          </div>
        )}
      </main>
      <footer className="pay-foot">
        {t.by}{" "}
        <a href={lang === "en" ? "/en" : "/"} target="_blank" rel="noreferrer">
          Sevrii
        </a>
      </footer>
    </div>
  );
}
