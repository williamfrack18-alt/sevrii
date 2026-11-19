"use client";

import { useEffect, useState } from "react";
import { reviewStateAction, saveReviewAction, type ReviewState } from "@/app/reviewActions";

const TEXT = {
  es: {
    title: (b: string) => `¿Cómo te fue con ${b}?`,
    sub: "Tu reseña aparece en su página como compra verificada. Puedes cambiarla cuando quieras.",
    star: (n: number) => `${n} de 5 estrellas`,
    text: "Cuéntale a otros cómo te fue (opcional)",
    name: "Tu nombre como se verá",
    send: "Publicar mi reseña",
    update: "Actualizar mi reseña",
    sending: "Publicando…",
    thanks: "¡Gracias! Tu reseña ya está en su página.",
    failed: "No se pudo publicar. Inténtalo de nuevo.",
    pick: "Elige de 1 a 5 estrellas.",
  },
  en: {
    title: (b: string) => `How did it go with ${b}?`,
    sub: "Your review shows on their page as a verified purchase. You can change it anytime.",
    star: (n: number) => `${n} out of 5 stars`,
    text: "Tell others how it went (optional)",
    name: "Your name as it will show",
    send: "Post my review",
    update: "Update my review",
    sending: "Posting…",
    thanks: "Thank you! Your review is on their page now.",
    failed: "Couldn't post it. Try again.",
    pick: "Pick 1 to 5 stars.",
  },
};

// A verified review: only shows to someone who bought from this business
// (their quick account, or the link emailed after paying).
export default function ReviewForm({ businessId, businessName, lang, token }: { businessId: string; businessName: string; lang: "es" | "en"; token?: string }) {
  const t = TEXT[lang];
  const [state, setState] = useState<ReviewState | null>(null);
  const [rating, setRating] = useState(0);
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    let alive = true;
    reviewStateAction({ businessId, token })
      .then((s) => {
        if (!alive) return;
        setState(s);
        setRating(s.rating);
        setText(s.text);
        setName(s.name);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [businessId, token]);

  if (!state?.canReview) return null;
  const had = state.rating > 0;

  return (
    <form
      className="rv-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!rating) {
          setMsg(t.pick);
          return;
        }
        setBusy(true);
        setMsg("");
        try {
          const r = await saveReviewAction({ businessId, token, rating, text, name });
          if (r.ok) setDone(true);
          else setMsg(t.failed);
        } catch {
          setMsg(t.failed);
        }
        setBusy(false);
      }}
    >
      <strong className="rv-title">{t.title(businessName)}</strong>
      <p className="rv-sub">{t.sub}</p>
      <div className="rv-stars" role="radiogroup">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={t.star(n)} className={n <= rating ? "on" : ""} onClick={() => setRating(n)}>
            ★
          </button>
        ))}
      </div>
      <textarea className="rv-input" rows={3} maxLength={800} value={text} onChange={(e) => setText(e.target.value)} placeholder={t.text} />
      <input className="rv-input" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder={t.name} />
      {msg && <p className="rv-msg">{msg}</p>}
      {done ? (
        <p className="rv-thanks">✓ {t.thanks}</p>
      ) : (
        <button type="submit" className="rv-btn" disabled={busy}>
          {busy ? t.sending : had ? t.update : t.send}
        </button>
      )}
    </form>
  );
}
