"use client";

import { useEffect, useState } from "react";
import { trackContactClickAction } from "@/app/actions";
import { channelClass } from "@/lib/storeContact";

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

export type { ContactChannel } from "@/lib/storeContact";
import type { ContactChannel } from "@/lib/storeContact";

export type ContactTargets = {
  channels: ContactChannel[]; // best first (see contactChannels in lib/site)
  wa: string | null; // E.164
  phone: string | null; // E.164
};

export type ContactLabels = {
  call: string;
  text: string;
  whatsapp: string;
  chat: string;
  msgService: string; // template with {biz} and {svc}
  msgGeneric: string; // template with {biz}
};

function waLink(e164: string, text: string) {
  return `https://wa.me/${e164.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
}
function smsLink(e164: string, text: string) {
  return `sms:${e164}?&body=${encodeURIComponent(text)}`;
}

export function ChannelIcon({ c }: { c: ContactChannel }) {
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (c === "call") return <svg {...common}><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" /></svg>;
  if (c === "text") return <svg {...common}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /><path d="M8 9h8M8 13h5" /></svg>;
  if (c === "whatsapp") return <svg {...common}><path d="M21 11.5a8.4 8.4 0 0 1-12.4 7.4L3 20.5l1.6-5.4A8.4 8.4 0 1 1 21 11.5z" /></svg>;
  return <svg {...common}><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12z" /><path d="M8.5 12h.01M12 12h.01M15.5 12h.01" strokeWidth={3} /></svg>;
}

// Opens the right app for each channel; "chat" opens the page chat with the
// service already written.
export function ContactLink({
  channel,
  businessId,
  businessName,
  service,
  contact,
  labels,
  className,
  children,
}: {
  channel: ContactChannel;
  businessId: string;
  businessName: string;
  service?: string;
  contact: ContactTargets;
  labels: Pick<ContactLabels, "msgService" | "msgGeneric">;
  className?: string;
  children: React.ReactNode;
}) {
  const msg = service
    ? labels.msgService.replace("{biz}", () => businessName).replace("{svc}", () => service)
    : labels.msgGeneric.replace("{biz}", () => businessName);
  if (channel === "chat") {
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
  const href =
    channel === "whatsapp" && contact.wa
      ? waLink(contact.wa, msg)
      : channel === "text" && contact.phone
        ? smsLink(contact.phone, msg)
        : contact.phone
          ? `tel:${contact.phone}`
          : "#";
  return (
    <Track href={href} businessId={businessId} channel={channel} className={className}>
      {children}
    </Track>
  );
}


// Service picker + price + contact buttons, like the Matheus buy box.
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
  labels: ContactLabels & {
    chooseLabel: string;
    selected: string;
    priceOnRequest: string;
    noContact: string;
    payNow: string;
  };
  ctaNote: string;
}) {
  const [sel, setSel] = useState(0);
  const svc = services[sel];
  const [first, ...rest] = contact.channels;

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
        {first ? (
          <ContactLink
            channel={first}
            businessId={businessId}
            businessName={businessName}
            service={svc?.name}
            contact={contact}
            labels={labels}
            className={`btn block ${svc?.payHref ? "ghost" : channelClass(first, true)}`}
          >
            <ChannelIcon c={first} /> {labels[first]}
          </ContactLink>
        ) : (
          <p className="micro">{labels.noContact}</p>
        )}
        {rest.length > 0 && (
          <div className="alt-row">
            {rest.map((c) => (
              <ContactLink key={c} channel={c} businessId={businessId} businessName={businessName} service={svc?.name} contact={contact} labels={labels} className="btn ghost">
                <ChannelIcon c={c} /> {labels[c]}
              </ContactLink>
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
