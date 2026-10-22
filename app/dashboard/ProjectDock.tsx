"use client";

import { useEffect, useState } from "react";
import { useLang } from "@/components/LangProvider";

// The project's card inside its own chat (Cerebro, Store and Marketing all
// use it the same way): always the last thing in the conversation, showing
// where this project stands right now, with a link to the full view that sits
// right under the chat (the map, or the page).
export default function ProjectDock({
  eyebrow,
  title,
  status,
  children,
  link,
}: {
  eyebrow: string;
  title: string;
  status?: React.ReactNode;
  children?: React.ReactNode;
  link?: { label: string; href: string };
}) {
  return (
    <div className="rounded-2xl p-4 md:p-5 flex flex-col gap-3.5 min-w-0" style={{ background: "#141414", boxShadow: "0 0 0 1px rgba(255,255,255,0.08)" }}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#8e8e8e] shrink-0">{eyebrow}</span>
          {status}
        </div>
        {link && (
          <a href={link.href} className="text-[12.5px] text-[#a1a1a1] hover:text-white shrink-0">
            {link.label}
          </a>
        )}
      </div>
      <span className="text-[17px] font-semibold text-white break-words leading-snug">{title}</span>
      {children}
    </div>
  );
}

// The full view under the chat: visibly part of the same conversation.
export function BelowChat({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <section id={id} className="px-4 md:px-8 pb-14 scroll-mt-4">
      <div className="flex flex-col items-center pt-1 pb-6" aria-hidden="true">
        <span className="h-6 w-px" style={{ background: "rgba(255,255,255,0.16)" }} />
      </div>
      <div className="max-w-[1100px] mx-auto flex flex-col gap-5 min-w-0">
        <div className="flex justify-center">
          <span className="text-[12px] px-3 py-1 rounded-full text-[#a1a1a1]" style={{ boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.12)" }}>
            {label}
          </span>
        </div>
        {children}
      </div>
    </section>
  );
}

// ---------- Inside the chat: a numbered list whose parts open in place ----------
export type StepItem = {
  id: string;
  label: string;
  title: string;
  summary?: string;
  tone?: "idle" | "done" | "warn" | "active";
  badge?: string;
  detail?: React.ReactNode;
};

export function StepList({ items, numbered = true }: { items: StepItem[]; numbered?: boolean }) {
  return (
    <ol className="flex flex-col min-w-0">
      {items.map((it, i) => (
        <StepRow key={it.id} item={it} n={numbered ? i + 1 : null} />
      ))}
    </ol>
  );
}

function StepRow({ item, n }: { item: StepItem; n: number | null }) {
  const [open, setOpen] = useState(false);
  const done = item.tone === "done";
  const warn = item.tone === "warn";
  return (
    <li className="min-w-0" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
      <button type="button" onClick={() => item.detail && setOpen((o) => !o)} aria-expanded={open} className="w-full flex items-start gap-3 py-3 text-left">
        <span
          className="h-6 w-6 rounded-full shrink-0 flex items-center justify-center text-[11.5px] font-semibold mt-0.5"
          style={done ? { background: "rgba(46,122,85,0.26)", color: "#7dbf9c" } : warn ? { background: "rgba(245,196,81,0.12)", color: "#f5c451" } : { boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.18)", color: "#a1a1a1" }}
        >
          {done ? "✓" : n ?? "•"}
        </span>
        <span className="flex-1 min-w-0 flex flex-col gap-0.5">
          <span className="text-[11px] uppercase tracking-[0.08em] text-[#8e8e8e]">{item.label}</span>
          <span className="text-[14.5px] text-white leading-snug break-words">{item.title}</span>
          {item.summary && <span className="text-[13px] text-[#a1a1a1] leading-relaxed break-words">{item.summary}</span>}
        </span>
        <span className="flex items-center gap-2 shrink-0 pt-0.5">
          {item.badge && <span className="text-[11.5px]" style={{ color: done ? "#7dbf9c" : warn ? "#f5c451" : "#8e8e8e" }}>{item.badge}</span>}
          {item.detail && (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a1a1a1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform .15s" }} aria-hidden="true">
              <path d="M6 9l6 6 6-6" />
            </svg>
          )}
        </span>
      </button>
      {open && item.detail && <div className="pl-9 pb-4 min-w-0">{item.detail}</div>}
    </li>
  );
}

// ---------- Opened from a card in the chat, closed back to the chat ----------
export function Sheet({ open, title, onClose, children, wide = false }: { open: boolean; title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  const lang = useLang();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] flex items-stretch md:items-center justify-center md:p-6" style={{ background: "rgba(0,0,0,0.72)" }} onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div
        className={`w-full ${wide ? "md:max-w-[1240px]" : "md:max-w-[860px]"} h-full md:h-[92vh] md:rounded-2xl flex flex-col overflow-hidden`}
        style={{ background: "#0b0b0b", boxShadow: "0 0 0 1px rgba(255,255,255,0.1)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 h-14 px-4 md:px-5 flex items-center justify-between gap-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <span className="text-[15px] font-semibold text-white truncate">{title}</span>
          <button type="button" onClick={onClose} className="h-9 px-4 rounded-full text-[13px] font-medium text-[#e5e5e5] shrink-0" style={{ background: "rgba(255,255,255,0.08)" }}>
            {lang === "en" ? "Back to chat" : "Volver al chat"}
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
