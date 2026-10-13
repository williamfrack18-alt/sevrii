"use client";

import { useEffect, useState } from "react";

// Signup panel headline that cycles through messages for different people:
// owners who want more customers and employees who want to go independent.
export default function RotatingHeadline({
  items,
  className = "",
  interval = 3800,
}: {
  items: { title: string; text: string }[];
  className?: string;
  interval?: number;
}) {
  const [i, setI] = useState(0);
  const [shown, setShown] = useState(true);

  useEffect(() => {
    if (items.length < 2) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let swap: ReturnType<typeof setTimeout> | undefined;
    const tick = setInterval(() => {
      setShown(false);
      swap = setTimeout(() => {
        setI((n) => (n + 1) % items.length);
        setShown(true);
      }, 450);
    }, interval);
    return () => {
      clearInterval(tick);
      if (swap) clearTimeout(swap);
    };
  }, [items.length, interval]);

  const cur = items[i];
  return (
    <div className={className} aria-live="polite">
      <div
        style={{
          opacity: shown ? 1 : 0,
          transform: shown ? "none" : "translateY(10px)",
          transition: "opacity .45s ease, transform .45s ease",
        }}
      >
        <h1 className="font-serif text-[48px] leading-[1.06]">{cur.title}</h1>
        <p className="mt-6 text-[17px] leading-relaxed max-w-sm" style={{ color: "rgba(255,255,255,.75)" }}>
          {cur.text}
        </p>
      </div>
      <div className="mt-8 flex gap-2" aria-hidden="true">
        {items.map((_, k) => (
          <span
            key={k}
            className="h-[3px] rounded-full transition-all duration-500"
            style={{ width: k === i ? 28 : 10, background: k === i ? "#fff" : "rgba(255,255,255,.3)" }}
          />
        ))}
      </div>
    </div>
  );
}
