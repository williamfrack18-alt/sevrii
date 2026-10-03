"use client";

import { trackContactClickAction } from "@/app/actions";

export default function ContactLink({
  href,
  businessId,
  channel,
  external,
  className,
  style,
  children,
}: {
  href: string;
  businessId: string;
  channel: "call" | "text" | "whatsapp";
  external?: boolean;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      className={className}
      style={style}
      onClick={() => {
        trackContactClickAction(businessId, channel).catch(() => {});
      }}
    >
      {children}
    </a>
  );
}
