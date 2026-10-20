"use client";

import { useEffect, useState } from "react";
import ChatWidget, { type ChatAgent } from "./ChatWidget";

type Lang = "es" | "en";

const UI = {
  es: { prev: "Foto anterior", next: "Siguiente", photo: (n: number) => `Ver foto ${n}`, video: "Ver video", slide: (s: string) => `Ver: ${s}`, ask: "Consultar" },
  en: { prev: "Previous photo", next: "Next", photo: (n: number) => `View photo ${n}`, video: "Watch video", slide: (s: string) => `View: ${s}`, ask: "Ask" },
};

export type MediaItem =
  | { kind: "video"; src: string; poster: string; label: string }
  | { kind: "photo"; src: string }
  | { kind: "slide"; tone: "service" | "offer"; kicker: string; title: string; price: string; text: string };

// Compact price for chips and thumbnails: the dollar amount when there is one
// ("$1,200", "$1.5k"), the owner's text when it's short, else "Ask".
function shortPrice(p: string, lang: Lang): string {
  const m = /\$\s?\d[\d,]*(?:\.\d+)?(?:\s?[kK]\b)?/.exec(p);
  if (m) return m[0].replace(/\s/g, "");
  const s = p.trim();
  if (!s) return "";
  return s.length <= 14 ? s : UI[lang].ask;
}

// Main stage + small squares below it (video, the owner's photos and cards
// with each package and its price), like the Matheus page.
export function Gallery({ items, alt, empty, lang }: { items: MediaItem[]; alt: string; empty: React.ReactNode; lang: Lang }) {
  const [i, setI] = useState(0);
  const ui = UI[lang];
  if (items.length === 0) return <div className="gallery"><div className="stage">{empty}</div></div>;
  const cur = items[Math.min(i, items.length - 1)];
  const go = (d: number) => setI((n) => (n + d + items.length) % items.length);
  return (
    <div className="gallery">
      <div className="stage">
        {cur.kind === "video" ? (
          <>
            <video key={cur.src} src={cur.src} poster={cur.poster || undefined} controls playsInline preload="metadata" />
            <span className="stage-chip">▶ {cur.label}</span>
          </>
        ) : cur.kind === "photo" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cur.src} alt={alt} />
        ) : (
          <div className={`slide ${cur.tone}`}>
            <span className="stage-kicker">{cur.kicker}</span>
            <div className="slide-title">{cur.title}</div>
            {cur.price && <div className="slide-price">{cur.price}</div>}
            {cur.text && <p className="slide-text">{cur.text}</p>}
          </div>
        )}
        {items.length > 1 && (
          <>
            <button type="button" className="stage-nav prev" aria-label={ui.prev} onClick={() => go(-1)}><span aria-hidden>‹</span></button>
            <button type="button" className="stage-nav next" aria-label={ui.next} onClick={() => go(1)}><span aria-hidden>›</span></button>
            <span className="stage-count tabular">{Math.min(i, items.length - 1) + 1} / {items.length}</span>
          </>
        )}
      </div>
      {items.length > 1 && (
        <div className="thumbs">
          {items.map((m, n) => (
            <button
              key={n}
              type="button"
              aria-label={m.kind === "video" ? ui.video : m.kind === "photo" ? ui.photo(n + 1) : ui.slide(m.title)}
              aria-pressed={n === i}
              className={`thumb ${m.kind} ${m.kind === "slide" ? m.tone : ""} ${n === i ? "active" : ""}`}
              style={m.kind === "photo" ? { backgroundImage: `url("${m.src}")` } : m.kind === "video" && m.poster ? { backgroundImage: `url("${m.poster}")` } : undefined}
              onClick={() => setI(n)}
            >
              {m.kind === "video" ? <span className="thumb-play" aria-hidden>▶</span> : m.kind === "slide" ? <span className="thumb-price" aria-hidden>{m.tone === "offer" ? "%" : shortPrice(m.price, lang) || "•"}</span> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// True once the offer's end time has passed (checked every second while open).
function useEnded(endsAt: string): boolean {
  const end = Date.parse(endsAt);
  const [ended, setEnded] = useState(false);
  useEffect(() => {
    if (Number.isNaN(end)) return;
    const check = () => {
      if (Date.now() >= end) {
        setEnded(true);
        return true;
      }
      return false;
    };
    if (check()) return;
    const id = setInterval(() => {
      if (check()) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [end]);
  return ended;
}

// Counts down to the owner's real end date. Never resets; disappears at the end.
export function Countdown({ endsAt }: { endsAt: string }) {
  const end = Date.parse(endsAt);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (now === null || Number.isNaN(end) || now >= end) return null;
  const left = end - now;
  const d = Math.floor(left / 86400000);
  const h = Math.floor((left % 86400000) / 3600000);
  const m = Math.floor((left % 3600000) / 60000);
  const s = Math.floor((left % 60000) / 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return <span className="tabular">{d > 0 ? `${d}d ` : ""}{pad(h)}:{pad(m)}:{pad(s)}</span>;
}

// Shows its children (an offer badge or band) only until the offer ends, so an
// offer that expires while the page is open goes away instead of freezing.
export function UntilOfferEnds({ endsAt, children }: { endsAt?: string | null; children: React.ReactNode }) {
  const ended = useEnded(endsAt || "");
  return ended ? null : <>{children}</>;
}

export type ChoiceService = { id: string; name: string; price: string; payHref?: string };

export function ChatIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12z" />
      <path d="M8.5 12h.01M12 12h.01M15.5 12h.01" strokeWidth={3} />
    </svg>
  );
}

// Brings the visitor to the page chat, with the service already written.
export function ChatLink({ service, className, children }: { service?: string; className?: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        window.dispatchEvent(new CustomEvent("sevrii:chat", { detail: service || "" }));
      }}
    >
      {children}
    </button>
  );
}

// Service picker + price + the chat, like the Matheus buy box: customers talk
// to the business right here (no calls or texts needed).
export function BuyActions({
  services,
  labels,
  chat,
  ctaNote,
  lang,
}: {
  services: ChoiceService[];
  labels: { chooseLabel: string; selected: string; priceOnRequest: string; payNow: string };
  chat: { slug: string; businessName: string; logoUrl: string; ownerName: string; ownerPhoto: string; lang: Lang; campaign?: string; agent?: ChatAgent | null } | null;
  ctaNote: string;
  lang: Lang;
}) {
  const [sel, setSel] = useState(0);
  const [picked, setPicked] = useState<string | undefined>();
  const svc = services[sel];

  return (
    <>
      {services.length > 1 && (
        <div className="selector">
          <div className="selector-label">{labels.chooseLabel}</div>
          <div className="chip-row">
            {services.map((s, n) => (
              <button
                key={s.id}
                type="button"
                aria-pressed={n === sel}
                className={`chip ${n === sel ? "active" : ""}`}
                onClick={() => {
                  setSel(n);
                  setPicked(s.name);
                }}
              >
                {s.name}
                {s.price ? <span className="chip-price"> · {shortPrice(s.price, lang)}</span> : null}
              </button>
            ))}
          </div>
        </div>
      )}
      {svc && (
        <div className="price-box">
          <div className="price-box-k">{labels.selected}: <strong>{svc.name}</strong></div>
          <div className="price-box-v grad-text">{svc.price || labels.priceOnRequest}</div>
        </div>
      )}
      {svc?.payHref && (
        <a href={svc.payHref} className="btn block pay">
          💳 {labels.payNow}
        </a>
      )}
      {chat && (
        <div id="chat" className="buy-chat">
          <ChatWidget {...chat} pick={picked} />
        </div>
      )}
      {ctaNote && (
        <div className="micro">
          <span className="dot" /> {ctaNote}
        </div>
      )}
    </>
  );
}
