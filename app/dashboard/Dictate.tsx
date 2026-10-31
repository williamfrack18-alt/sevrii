"use client";

import { useEffect, useRef, useState } from "react";

// A microphone button that writes what you say into a text box (the
// browser's own speech recognition: no cost, nothing is recorded). The text
// is not sent by itself: you read it and send it.
type Rec = { lang: string; interimResults: boolean; continuous: boolean; start: () => void; stop: () => void; onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null };

export default function Dictate({ lang, base, onText, disabled, className = "" }: { lang: "es" | "en"; base: string; onText: (text: string) => void; disabled?: boolean; className?: string }) {
  const [can, setCan] = useState(false);
  const [on, setOn] = useState(false);
  const rec = useRef<Rec | null>(null);
  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
    setCan(Boolean(w.SpeechRecognition || w.webkitSpeechRecognition));
    return () => rec.current?.stop();
  }, []);
  if (!can) return null;
  function start() {
    const W = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
    const R = W.SpeechRecognition || W.webkitSpeechRecognition;
    if (!R) return;
    const r = new R();
    r.lang = lang === "es" ? "es-US" : "en-US";
    r.interimResults = true;
    r.continuous = false;
    const before = base.trim();
    let finalText = "";
    r.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const x = e.results[i];
        if (x.isFinal) finalText += x[0].transcript;
        else interim += x[0].transcript;
      }
      onText([before, (finalText + interim).trim()].filter(Boolean).join(" "));
    };
    r.onend = () => {
      setOn(false);
      rec.current = null;
    };
    r.onerror = () => setOn(false);
    rec.current = r;
    setOn(true);
    r.start();
  }
  const label = on ? (lang === "es" ? "Dejar de escuchar" : "Stop listening") : lang === "es" ? "Hablar en vez de escribir" : "Speak instead of typing";
  return (
    <button
      type="button"
      onClick={() => (on ? rec.current?.stop() : start())}
      disabled={disabled && !on}
      aria-label={label}
      title={label}
      className={`h-10 w-10 md:h-8 md:w-8 shrink-0 rounded-lg flex items-center justify-center transition disabled:opacity-40 ${className}`}
      style={on ? { background: "#16A34A", color: "#fff" } : { color: "#3F3F46" }}
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
      </svg>
    </button>
  );
}
