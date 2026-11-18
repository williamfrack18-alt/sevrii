"use client";

import { useEffect } from "react";
import { pageOrderAction } from "@/app/pageStatsActions";

type Fbq = (...args: unknown[]) => void;

// The page's numbers for its owner: a tap on "Pedir" (a service's chat button)
// is counted, and when the owner added their Meta pixel, the visitor's steps
// go to it too (PageView is sent by the pixel itself).
export default function PageTracking({ slug, pixel }: { slug: string; pixel: boolean }) {
  useEffect(() => {
    const fbq = () => (pixel ? ((window as unknown as { fbq?: Fbq }).fbq ?? null) : null);
    const onChat = (e: Event) => {
      const svc = (e as CustomEvent<string>).detail;
      if (!svc) return;
      pageOrderAction({ slug }).catch(() => {});
      fbq()?.("trackCustom", "PedirServicio", { content_name: String(svc).slice(0, 100) });
    };
    const onContact = () => fbq()?.("track", "Contact");
    window.addEventListener("sevrii:chat", onChat);
    window.addEventListener("sevrii:contact", onContact);
    return () => {
      window.removeEventListener("sevrii:chat", onChat);
      window.removeEventListener("sevrii:contact", onContact);
    };
  }, [slug, pixel]);
  return null;
}
