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

export function Gallery({ images, alt, empty }: { images: string[]; alt: string; empty: React.ReactNode }) {
  const [i, setI] = useState(0);
  if (images.length === 0) return <div className="gallery"><div className="stage">{empty}</div></div>;
  return (
    <div className="gallery">
      {images.length > 1 && (
        <div className="thumbs">
          {images.map((src, n) => (
            <button
              key={src}
              type="button"
              aria-label={`${n + 1}`}
              className={`thumb ${n === i ? "active" : ""}`}
              style={{ backgroundImage: `url("${src}")` }}
              onClick={() => setI(n)}
            />
          ))}
        </div>
      )}
      <div className="stage">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={images[i]} alt={alt} />
      </div>
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

export type ChoiceService = { id: string; name: string; price: string };

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
              </button>
            ))}
          </div>
        </div>
      )}
      {svc && (
        <div className="price-note">
          <span>{labels.selected}</span>
          <strong>
            {svc.name} — {svc.price || labels.priceOnRequest}
          </strong>
        </div>
      )}
      <div className="cta-block">
        {primary ? (
          <Track href={primary.href} businessId={businessId} channel={primary.channel} className="btn block">
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
