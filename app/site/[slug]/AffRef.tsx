"use client";

import { useEffect } from "react";
import { affiliateVisitAction } from "@/app/affiliateActions";

// A visit from an affiliate's link (?ref=code): remembered for 30 days so the
// customer's payment counts for them, and counted once per visit.
export default function AffRef({ businessId, slug }: { businessId: string; slug: string }) {
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("ref") || "";
    if (!/^[a-z0-9]{6,12}$/i.test(code)) return;
    document.cookie = `saff_${businessId}=${code.toLowerCase()}; Max-Age=${30 * 24 * 3600}; Path=/; SameSite=Lax; Secure`;
    try {
      const k = `saff_seen_${businessId}`;
      if (sessionStorage.getItem(k) === code) return;
      sessionStorage.setItem(k, code);
    } catch {
      // private mode: count it anyway
    }
    affiliateVisitAction({ slug, code }).catch(() => {});
  }, [businessId, slug]);
  return null;
}
