"use client";

import { useEffect, useRef, useState } from "react";
import { canListen, listenError, listenOnce, type ListenHandle } from "./speech";

// A microphone button that writes what you say into a text box (the
// browser's own speech recognition: no cost, nothing is recorded). The text
// is not sent by itself: you read it and send it.
export default function Dictate({ lang, base, onText, disabled, className = "" }: { lang: "es" | "en"; base: string; onText: (text: string) => void; disabled?: boolean; className?: string }) {
  const [can, setCan] = useState(false);
  const [on, setOn] = useState(false);
  const [msg, setMsg] = useState("");
  const rec = useRef<ListenHandle | null>(null);
  useEffect(() => {
    setCan(canListen());
    return () => rec.current?.stop();
  }, []);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(""), 6000);
    return () => clearTimeout(t);
  }, [msg]);
  if (!can) return null;
  function start() {
    setMsg("");
    const before = base.trim();
    const h = listenOnce(
      lang,
      (text) => onText([before, text].filter(Boolean).join(" ")),
      (text, err) => {
        setOn(false);
        rec.current = null;
        if (!text) setMsg(listenError(err || "no-speech", lang));
      }
    );
    if (!h) {
      setMsg(listenError("start", lang));
      return;
    }
    rec.current = h;
    setOn(true);
  }
  const label = on ? (lang === "es" ? "Dejar de escuchar" : "Stop listening") : lang === "es" ? "Hablar en vez de escribir" : "Speak instead of typing";
  return (
    <span className="relative inline-flex shrink-0">
      <button
        type="button"
        onClick={() => (on ? rec.current?.stop() : start())}
        disabled={disabled && !on}
        aria-label={label}
        aria-pressed={on}
        title={label}
        className={`h-10 w-10 md:h-8 md:w-8 shrink-0 rounded-lg flex items-center justify-center transition disabled:opacity-40 ${className}`}
        style={on ? { background: "#16A34A", color: "#fff" } : { color: "#3F3F46" }}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
        </svg>
      </button>
      {msg && (
        <span role="status" className="absolute bottom-full right-0 mb-2 w-[220px] rounded-xl bg-white px-3 py-2 text-[12.5px] leading-snug text-pfg2 z-20" style={{ boxShadow: "0 8px 24px -8px rgba(10,10,10,.25), 0 0 0 1px rgba(10,10,10,.08)" }}>
          {msg}
        </span>
      )}
    </span>
  );
}
