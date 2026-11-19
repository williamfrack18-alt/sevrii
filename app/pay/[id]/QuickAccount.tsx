"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { quickAccountAction } from "@/app/reviewActions";

const TEXT = {
  es: {
    title: "Antes de pagar",
    sub: "Crea tu cuenta en segundos: solo tu nombre y tu correo. Así tu pago queda a tu nombre y después puedes dejar tu reseña.",
    name: "Tu nombre",
    email: "Tu correo",
    go: "Continuar al pago",
    busy: "Un momento…",
    errName: "Escribe tu nombre.",
    errEmail: "Revisa tu correo.",
    errRate: "Demasiados intentos. Espera unos minutos.",
    errFailed: "No se pudo. Inténtalo de nuevo.",
    terms: "Al continuar aceptas los Términos y la Política de privacidad de Sevrii.",
  },
  en: {
    title: "Before you pay",
    sub: "Create your account in seconds: just your name and email. Your payment goes under your name and afterwards you can leave your review.",
    name: "Your name",
    email: "Your email",
    go: "Continue to payment",
    busy: "One moment…",
    errName: "Write your name.",
    errEmail: "Check your email.",
    errRate: "Too many attempts. Wait a few minutes.",
    errFailed: "That didn't work. Try again.",
    terms: "By continuing you accept Sevrii's Terms and Privacy Policy.",
  },
};

// The customer's quick account on the pay page: name + email, then the
// normal "Pay" button shows.
export default function QuickAccount({ lang }: { lang: "es" | "en" }) {
  const t = TEXT[lang];
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  return (
    <form
      className="pay-account"
      onSubmit={(e) => {
        e.preventDefault();
        setErr("");
        start(async () => {
          try {
            const r = await quickAccountAction({ name, email });
            if (!r.ok) {
              setErr(r.error === "name" ? t.errName : r.error === "email" ? t.errEmail : r.error === "rate" ? t.errRate : t.errFailed);
              return;
            }
            router.refresh();
          } catch {
            setErr(t.errFailed);
          }
        });
      }}
    >
      <strong className="pay-account-title">{t.title}</strong>
      <p className="pay-account-sub">{t.sub}</p>
      <input className="pay-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t.name} autoComplete="name" maxLength={40} required />
      <input className="pay-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t.email} autoComplete="email" maxLength={160} required />
      {err && <p className="pay-error">{err}</p>}
      <button type="submit" className="pay-btn" disabled={pending}>
        {pending ? t.busy : t.go}
      </button>
      <p className="pay-account-terms">
        {t.terms.split(/(Términos|Terms|Política de privacidad|Privacy Policy)/).map((part, i) =>
          /^(Términos|Terms)$/.test(part) ? (
            <a key={i} href={lang === "en" ? "/en/terminos" : "/terminos"} target="_blank" rel="noreferrer">{part}</a>
          ) : /^(Política de privacidad|Privacy Policy)$/.test(part) ? (
            <a key={i} href={lang === "en" ? "/en/privacidad" : "/privacidad"} target="_blank" rel="noreferrer">{part}</a>
          ) : (
            part
          )
        )}
      </p>
    </form>
  );
}
