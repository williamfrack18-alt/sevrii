"use client";

import { useMemo, useRef, useState } from "react";
import { useLang } from "@/components/LangProvider";
import { ACCENT, BRAND_BTN, GREEN, INK, TINT } from "@/lib/panel";
import { cardDone, cardsFor, emptyAnswer, suggest, type CardAnswer, type CardAnswers } from "@/lib/cards";

// The Brain's interview on cards: one question per card, in order, with its
// progress, a search box that suggests while typing, "no sé" on every card that
// allows it, and a way back that never loses an answer. Only when every card is
// answered does "Ver mis propuestas" send them (the server checks it again).
export default function CardFlow({
  mode,
  initial,
  busy,
  notice,
  onSave,
}: {
  mode: "new" | "existing";
  initial: CardAnswers;
  busy: boolean;
  notice?: string;
  onSave: (answers: CardAnswers, submit: boolean) => void;
}) {
  const lang = useLang();
  const es = lang === "es";
  const defs = cardsFor(mode);
  const [answers, setAnswers] = useState<CardAnswers>(() => ({ ...initial }));
  // Start on the first card still to answer.
  const [at, setAt] = useState(() => Math.max(0, defs.findIndex((d) => !cardDone(d, initial[d.id]))));
  const def = defs[Math.min(at, defs.length - 1)];
  const a: CardAnswer = answers[def.id] ?? emptyAnswer();
  const done = defs.filter((d) => cardDone(d, answers[d.id])).length;
  const allDone = done === defs.length;
  const box = useRef<HTMLTextAreaElement>(null);

  const set = (patch: Partial<CardAnswer>) => setAnswers((prev) => ({ ...prev, [def.id]: { ...(prev[def.id] ?? emptyAnswer()), ...patch } }));
  const hints = useMemo(() => suggest(def, lang, a.v), [def, lang, a.v]);
  const needsPlace = def.placeAlways || (def.placeFor?.includes(a.c) ?? false);
  const ok = cardDone(def, a);
  const last = at === defs.length - 1;

  function add(s: string) {
    const parts = a.v.split(/[,;]/).map((x) => x.trim()).filter(Boolean);
    // The word being typed is replaced by the suggestion it matched.
    const fold = (x: string) => x.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const typing = /[,;]\s*$/.test(a.v) ? "" : parts[parts.length - 1] ?? "";
    if (typing && fold(s).includes(fold(typing))) parts.pop();
    set({ v: [...parts, s].join(", "), u: false });
    box.current?.focus();
  }
  function next() {
    if (!ok) return;
    onSave(answers, last);
    if (!last) setAt((n) => n + 1);
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-2 md:px-4 pb-4">
      <div className="max-w-[720px] mx-auto flex flex-col gap-4 pt-2">
        {/* Progress */}
        <div className="dash-on-dark flex flex-col gap-2">
          <div className="flex items-center justify-between text-[13px]">
            <span className="text-pfg2">
              {es ? "Pregunta" : "Question"} {at + 1} {es ? "de" : "of"} {defs.length}
            </span>
            <span className="text-pmuted">
              {done} {es ? "contestadas" : "answered"}
            </span>
          </div>
          <div className="flex gap-1" aria-hidden="true">
            {defs.map((d, i) => (
              <button
                key={d.id}
                type="button"
                tabIndex={-1}
                onClick={() => setAt(i)}
                className="h-1.5 flex-1 rounded-full"
                style={{ background: cardDone(d, answers[d.id]) ? "#4ADE80" : i === at ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.22)" }}
              />
            ))}
          </div>
        </div>

        {/* The card */}
        <div className="rounded-[24px] bg-white p-5 md:p-7 flex flex-col gap-4" style={{ boxShadow: "0 0 0 1px rgba(255,255,255,0.04), 0 30px 60px -30px rgba(0,0,0,0.85)" }}>
          <div className="flex flex-col gap-1.5">
            <h2 className="text-[21px] md:text-[24px] font-semibold leading-tight" style={{ color: INK }}>
              {def.title[lang]}
            </h2>
            <p className="text-[14px] text-psub leading-relaxed">{def.help[lang]}</p>
          </div>

          {def.choices && (
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={def.title[lang]}>
              {def.choices.map((c) => {
                const on = a.c === c.id && !a.u;
                return (
                  <button
                    key={c.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => set({ c: c.id, u: false })}
                    className="h-11 px-5 rounded-full text-[15px] font-semibold"
                    style={on ? { background: INK, color: "#fff" } : { background: "rgba(10,10,10,0.06)", color: INK }}
                  >
                    {c.label[lang]}
                  </button>
                );
              })}
            </div>
          )}

          {(!def.choices || def.id === "goal") && (
            <textarea
              ref={box}
              value={a.v}
              onChange={(e) => set({ v: e.target.value, u: false })}
              placeholder={def.placeholder[lang]}
              rows={2}
              className="w-full rounded-2xl px-4 py-3 text-[16px] leading-relaxed outline-none resize-none"
              style={{ background: "rgba(10,10,10,0.04)", boxShadow: "inset 0 0 0 1px rgba(10,10,10,0.1)", color: INK }}
            />
          )}

          {needsPlace && (
            <input
              value={a.p}
              onChange={(e) => set({ p: e.target.value, u: false })}
              placeholder={def.placeAlways ? (es ? "Ciudad y estado (ej.: Miami, FL) o «en línea»" : "City and state (e.g. Miami, FL) or \"online\"") : def.placeholder[lang]}
              className="w-full h-12 rounded-2xl px-4 text-[16px] outline-none"
              style={{ background: "rgba(10,10,10,0.04)", boxShadow: "inset 0 0 0 1px rgba(10,10,10,0.1)", color: INK }}
            />
          )}

          {hints.length > 0 && (
            <div className="flex flex-wrap gap-2" aria-label={es ? "Sugerencias" : "Suggestions"}>
              {hints.map((h) => (
                <button key={h} type="button" onClick={() => add(h)} className="h-9 px-3.5 rounded-full text-[13.5px]" style={{ background: TINT, color: ACCENT }}>
                  + {h}
                </button>
              ))}
            </div>
          )}

          {def.unknown && (
            <button
              type="button"
              onClick={() => set({ u: !a.u, v: a.u ? a.v : "", c: a.u ? a.c : "", p: a.u ? a.p : "" })}
              aria-pressed={a.u}
              className="self-start h-10 px-4 rounded-full text-[14px] font-medium"
              style={a.u ? { background: INK, color: "#fff" } : { background: "#fff", color: INK, boxShadow: "inset 0 0 0 1px rgba(10,10,10,0.18)" }}
            >
              {a.u ? "✓ " : ""}
              {def.unknown[lang]}
            </button>
          )}
          {a.u && <p className="text-[13px] text-psub">{es ? "Queda como «no sé». No voy a suponer nada en su lugar." : "Saved as \"don't know\". I won't assume anything instead."}</p>}

          <div className="flex items-center justify-between gap-3 pt-1">
            <button type="button" disabled={at === 0} onClick={() => setAt((n) => Math.max(0, n - 1))} className="h-11 px-4 rounded-full text-[14px] text-psub disabled:opacity-30">
              ← {es ? "Atrás" : "Back"}
            </button>
            <button type="button" disabled={!ok || busy || (last && !allDone)} onClick={next} className="h-11 px-6 rounded-full text-[15px] font-semibold disabled:opacity-40" style={BRAND_BTN}>
              {last ? (busy ? (es ? "Enviando…" : "Sending…") : mode === "new" ? (es ? "Ver mis propuestas" : "See my proposals") : es ? "Armar mi estrategia" : "Build my strategy") : es ? "Siguiente" : "Next"}
            </button>
          </div>
          {last && !allDone && (
            <p className="text-[13px]" style={{ color: "#B45309" }}>
              {es ? "Te falta contestar alguna tarjeta: toca la barra de arriba para volver a ella." : "A card is still unanswered: tap the bar above to go back to it."}
            </p>
          )}
          {notice && <p className="text-[13px]" style={{ color: "#B45309" }}>{notice}</p>}
        </div>

        <p className="dash-on-dark text-[12.5px] text-pmuted text-center">
          {es ? "Todo lo que contestes queda guardado. Puedes volver a cualquier tarjeta sin perder las demás." : "Everything you answer is saved. You can go back to any card without losing the others."}
          <span style={{ color: GREEN }}> ●</span>
        </p>
      </div>
    </div>
  );
}
