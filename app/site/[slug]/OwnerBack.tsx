"use client";

import { useEffect, useState } from "react";

// The owner looking at their own page outside the panel's preview (e.g. from
// the phone app, where there is no back button): a small way back to the panel.
export default function OwnerBack({ es }: { es: boolean }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      setShow(window.self === window.top);
    } catch {
      setShow(false);
    }
  }, []);
  if (!show) return null;
  return (
    <a href="/dashboard?view=store" className="owner-back" aria-label={es ? "Volver a mi panel" : "Back to my dashboard"}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M15 18l-6-6 6-6" />
      </svg>
      {es ? "Mi panel" : "My dashboard"}
    </a>
  );
}
