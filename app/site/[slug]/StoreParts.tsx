"use client";

import { useEffect, useState } from "react";
import { trackContactClickAction } from "@/app/actions";

type Channel = "call" | "text" | "whatsapp";

export function Track({
  href,
  businessId,
  channel,
  className,
  children,
}: {
  href: string;
  businessId: string;
  channel: Channel;
  className?: string;
  children: React.ReactNode;
}) {
  const external = href.startsWith("http");
  return (
    <a
      href={href}
      className={className}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      onClick={() => {
        trackContactClickAction(businessId, channel).catch(() => {});
      }}
    >
      {children}
    </a>
  );
}

export type MediaItem =
  | { kind: "video"; src: string; poster: string; label: string }
  | { kind: "photo"; src: string }
  | { kind: "slide"; tone: "service" | "offer"; kicker: string; title: string; price: string; text: string };

function shortPrice(p: string): string {
  const m = /\$\s?[\d,.]+/.exec(p);
  return m ? m[0].replace(/\s/g, "") : p.slice(0, 8);
}

// Main stage + small squares below it (video, the owner's photos and cards
// with each package and its price), like the Matheus page.
export function Gallery({ items, alt, empty }: { items: MediaItem[]; alt: string; empty: React.ReactNode }) {
  const [i, setI] = useState(0);
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
            <button type="button" className="stage-nav prev" aria-label="‹" onClick={() => go(-1)}>‹</button>
            <button type="button" className="stage-nav next" aria-label="›" onClick={() => go(1)}>›</button>
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
              aria-label={`${n + 1}`}
              className={`thumb ${m.kind} ${m.kind === "slide" ? m.tone : ""} ${n === i ? "active" : ""}`}
              style={m.kind === "photo" ? { backgroundImage: `url("${m.src}")` } : m.kind === "video" && m.poster ? { backgroundImage: `url("${m.poster}")` } : undefined}
              onClick={() => setI(n)}
            >
              {m.kind === "video" ? <span className="thumb-play">▶</span> : m.kind === "slide" ? <span className="thumb-price">{m.tone === "offer" ? "%" : shortPrice(m.price) || "•"}</span> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Counts down to the owner's real end date. Never resets.
export function Countdown({ endsAt }: { endsAt: string }) {
  const end = Date.parse(endsAt);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (now === null) return null;
  const left = Math.max(0, end - now);
  const d = Math.floor(left / 86400000);
  const h = Math.floor((left % 86400000) / 3600000);
  const m = Math.floor((left % 3600000) / 60000);
  const s = Math.floor((left % 60000) / 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return <span className="tabular">{d > 0 ? `${d}d ` : ""}{pad(h)}:{pad(m)}:{pad(s)}</span>;
}

export type ChoiceService = { id: string; name: string; price: string; payHref?: string };

export type ContactTargets = {
  wa: string | null; // E.164
  phone: string | null; // E.164
  textEnabled: boolean;
};

function waLink(e164: string, text: string) {
  return `https://wa.me/${e164.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
}
function smsLink(e164: string, text: string) {
  return `sms:${e164}?&body=${encodeURIComponent(text)}`;
}

// Service picker + price + main buttons, like the Matheus buy box.
export function BuyActions({
  businessId,
  businessName,
  services,
  contact,
  labels,
  ctaNote,
}: {
  businessId: string;
  businessName: string;
  services: ChoiceService[];
  contact: ContactTargets;
  labels: {
    chooseLabel: string;
    selected: string;
    priceOnRequest: string;
    writeWhatsapp: string;
    callNow: string;
    text: string;
    msgService: string; // template with {biz} and {svc}
    msgGeneric: string;
    noContact: string;
    price: string;
    payNow: string;
  };
  ctaNote: string;
}) {
  const [sel, setSel] = useState(0);
  const svc = services[sel];
  const msg = svc
    ? labels.msgService.replace("{biz}", businessName).replace("{svc}", svc.name)
    : labels.msgGeneric.replace("{biz}", businessName);

  const primary: { href: string; channel: Channel; label: string } | null = contact.wa
    ? { href: waLink(contact.wa, msg), channel: "whatsapp", label: `💬 ${labels.writeWhatsapp}` }
    : contact.phone
      ? { href: `tel:${contact.phone}`, channel: "call", label: `📞 ${labels.callNow}` }
      : null;
  const secondary: { href: string; channel: Channel; label: string }[] = [];
  if (contact.wa && contact.phone) secondary.push({ href: `tel:${contact.phone}`, channel: "call", label: `📞 ${labels.callNow}` });
  if (contact.phone && contact.textEnabled) secondary.push({ href: smsLink(contact.phone, msg), channel: "text", label: `✉️ ${labels.text}` });

  return (
    <>
      {services.length > 0 && (
        <div className="selector">
          <div className="selector-label">{labels.chooseLabel}</div>
          <div className="chip-row">
            {services.map((s, n) => (
              <button key={s.id} type="button" className={`chip ${n === sel ? "active" : ""}`} onClick={() => setSel(n)}>
                {s.name}
                {s.price ? <span className="chip-price"> · {shortPrice(s.price)}</span> : null}
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
      <div className="cta-block">
        {svc?.payHref && (
          <a href={svc.payHref} className="btn block pay">
            💳 {labels.payNow}
          </a>
        )}
        {primary ? (
          <Track href={primary.href} businessId={businessId} channel={primary.channel} className={`btn block ${svc?.payHref ? "ghost" : ""}`}>
            {primary.label}
          </Track>
        ) : (
          <p className="micro">{labels.noContact}</p>
        )}
        {secondary.length > 0 && (
          <div style={{ display: "flex", gap: 10 }}>
            {secondary.map((b) => (
              <Track key={b.channel} href={b.href} businessId={businessId} channel={b.channel} className="btn ghost block" >
                {b.label}
              </Track>
            ))}
          </div>
        )}
        {ctaNote && (
          <div className="micro">
            <span className="dot" /> {ctaNote}
          </div>
        )}
      </div>
    </>
  );
}
