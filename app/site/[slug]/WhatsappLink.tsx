"use client";

import { trackWhatsappClickAction } from "@/app/actions";

export default function WhatsappLink({
  href,
  businessId,
  className,
  style,
  children,
}: {
  href: string;
  businessId: string;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      style={style}
      onClick={() => {
        trackWhatsappClickAction(businessId);
      }}
    >
      {children}
    </a>
  );
}
