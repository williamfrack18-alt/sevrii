"use client";

import { useMemo, useRef, useState } from "react";
import { useLang } from "@/components/LangProvider";
import { cardDone, cardsFor, emptyAnswer, type CardAnswer, type CardAnswers } from "@/lib/cards";

// The Brain's interview on cards: one question per card, in order, with its
// progress, a search box that suggests while typing, "no sé" on every card that
// allows it, and a way back that never loses an answer. Only when every card is
// answered does the last button send them (the server checks it again).
// Look: a light, calm screen (Sevrii's black, white and green, sans type).

const INK = "#0A0A0A";
const PAGE = "#F5F5F2"; // very light warm gray behind the card
const SOFT = "#ECFDF3"; // light green behind the illustration
const DEEP_GREEN = "#14532D";
const LINE = "rgba(10,10,10,0.10)";

// Where each question belongs, and why it's asked (people answer better when
// they know what an answer is for).
const GROUP: Record<string, { es: string; en: string }> = {
  talent: { es: "Sobre ti", en: "About you" },
  experience: { es: "Sobre ti", en: "About you" },
  likes: { es: "Sobre ti", en: "About you" },
  notWant: { es: "Tus límites", en: "Your limits" },
  resources: { es: "Tu situación", en: "Your situation" },
  time: { es: "Tu situación", en: "Your situation" },
  delivery: { es: "Tu situación", en: "Your situation" },
  income: { es: "Tu meta", en: "Your goal" },
  service: { es: "Tu negocio hoy", en: "Your business today" },
  prices: { es: "Tu negocio hoy", en: "Your business today" },
  costs: { es: "Tu negocio hoy", en: "Your business today" },
  hours: { es: "Tu negocio hoy", en: "Your business today" },
  clients: { es: "Tus clientes", en: "Your customers" },
  assets: { es: "Tus recursos", en: "Your resources" },
  goal: { es: "Tu meta", en: "Your goal" },
};
const WHY: Record<string, { es: string; en: string }> = {
  talent: { es: "Lo que ya te sale bien es lo más rápido de cobrar.", en: "What you're already good at is the fastest to charge for." },
  experience: { es: "Tus trabajos esconden habilidades que se pueden vender.", en: "Your jobs hide skills people pay for." },
  likes: { es: "Un servicio que disfrutas es uno que vas a sostener.", en: "A service you enjoy is one you'll keep doing." },
  notWant: { es: "Nada de lo que pongas aquí aparecerá en tus ideas.", en: "Nothing you put here will show up in your ideas." },
  resources: { es: "Así busco ideas que puedas empezar con lo que ya tienes.", en: "So I look for ideas you can start with what you have." },
  time: { es: "Así calculo cuánto podrías ganar con tus horas.", en: "So I can work out what you could earn with your hours." },
  delivery: { es: "Así busco precios y clientes reales de tu zona.", en: "So I find real prices and customers in your area." },
  income: { es: "Así sé qué ideas llegan a tu meta.", en: "So I know which ideas reach your goal." },
  service: { es: "Así investigo tu mercado exacto.", en: "So I research your exact market." },
  prices: { es: "Tus precios se respetan; nunca los cambio sin tu OK.", en: "Your prices are kept; I never change them without your OK." },
  costs: { es: "Así sé cuánto te queda de verdad.", en: "So I know what you really keep." },
  hours: { es: "Así calculo cuánto puedes crecer.", en: "So I can work out how much you can grow." },
  clients: { es: "Así sé a quién venderle más.", en: "So I know who to sell more to." },
  assets: { es: "Así aprovecho lo que ya tienes.", en: "So I make the most of what you have." },
  goal: { es: "Toda la estrategia apunta a esto.", en: "The whole strategy aims at this." },
};

// Sevrii's mark: the logo file as a mask, painted in any colour.
function SevriiMark({ size = 18, color = INK }: { size?: number; color?: string }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block shrink-0"
      style={{
        width: size * 0.76,
        height: size,
        background: color,
        WebkitMask: "url('/assets/sevrii-logo.png') center / contain no-repeat",
        mask: "url('/assets/sevrii-logo.png') center / contain no-repeat",
      }}
    />
  );
}

const fold = (x: string) => x.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const partsOf = (v: string) => v.split(/[,;]/).map((x) => x.trim()).filter(Boolean);

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
  // Start on the first card still to answer (all answered: on the last one,
  // where the send button is, not back on the first).
  const [at, setAt] = useState(() => {
    const i = defs.findIndex((d) => !cardDone(d, initial[d.id]));
    return i < 0 ? defs.length - 1 : i;
  });
  const def = defs[Math.min(at, defs.length - 1)];
  const a: CardAnswer = answers[def.id] ?? emptyAnswer();
  const done = defs.filter((d) => cardDone(d, answers[d.id])).length;
  const allDone = done === defs.length;
  const box = useRef<HTMLTextAreaElement>(null);

  const set = (patch: Partial<CardAnswer>) => setAnswers((prev) => ({ ...prev, [def.id]: { ...(prev[def.id] ?? emptyAnswer()), ...patch } }));
  const needsPlace = def.placeAlways || (def.placeFor?.includes(a.c) ?? false);
  const ok = cardDone(def, a);
  const last = at === defs.length - 1;

  // Chips: the ones already picked stay marked; the rest are filtered by what
  // is being typed (the search box).
  const picked = useMemo(() => new Set(partsOf(a.v).map(fold)), [a.v]);
  const chips = useMemo(() => {
    const all = def.suggestions[lang];
    const typing = /[,;]\s*$/.test(a.v) ? "" : fold(partsOf(a.v).pop() ?? "");
    const searching = typing && !all.some((s) => fold(s) === typing);
    return all.filter((s) => picked.has(fold(s)) || !searching || fold(s).includes(typing)).slice(0, 14);
  }, [def, lang, a.v, picked]);

  function toggleChip(s: string) {
    const parts = partsOf(a.v);
    if (picked.has(fold(s))) {
      set({ v: parts.filter((x) => fold(x) !== fold(s)).join(", "), u: false });
      return;
    }
    // The word being typed is replaced by the suggestion it matched.
    const typing = /[,;]\s*$/.test(a.v) ? "" : parts[parts.length - 1] ?? "";
    if (typing && !def.suggestions[lang].some((x) => fold(x) === fold(typing)) && fold(s).includes(fold(typing))) parts.pop();
    set({ v: [...parts, s].join(", "), u: false });
    box.current?.focus();
  }
  // What the server already has, so moving between cards saves only changes.
  const saved = useRef(JSON.stringify(initial));
  function save(submit: boolean) {
    saved.current = JSON.stringify(answers);
    onSave(answers, submit);
  }
  function next() {
    if (!ok) return;
    save(last);
    if (!last) setAt((n) => n + 1);
  }
  // Going back (or jumping with the dots) keeps what was typed on this card:
  // it is saved too, not only on "Siguiente", so leaving the page never loses it.
  function go(i: number) {
    if (!busy && JSON.stringify(answers) !== saved.current) save(false);
    setAt(Math.max(0, Math.min(defs.length - 1, i)));
  }

  const field = { background: "#FFFFFF", boxShadow: `inset 0 0 0 1px ${LINE}`, color: INK } as const;

  return (
    <div
      className="flex-1 min-h-0 overflow-y-auto mx-2 md:mx-4 mb-2 md:mb-4 rounded-[28px]"
      style={{ background: `radial-gradient(120% 60% at 50% 0%, #EAF7EF 0%, ${PAGE} 55%)` }}
    >
      <div className="max-w-[680px] mx-auto px-4 md:px-6 py-6 md:py-10 flex flex-col gap-6">
        {/* Brand line: who is asking and what for */}
        <div className="flex items-center gap-3">
          <span className="h-10 w-10 rounded-full flex items-center justify-center shrink-0" style={{ background: INK }}>
            <SevriiMark size={20} color="#FFFFFF" />
          </span>
          <div className="flex flex-col min-w-0">
            <span className="text-[14.5px] font-semibold leading-tight" style={{ color: INK }}>
              {es ? "Cerebro de Sevrii" : "Sevrii Brain"}
            </span>
            <span className="text-[12.5px] leading-tight" style={{ color: "#52525B" }}>
              {mode === "new" ? (es ? "Descubramos qué servicio puedes ofrecer" : "Let's find the service you can offer") : es ? "Armemos la estrategia de tu servicio" : "Let's build your service strategy"}
            </span>
          </div>
        </div>

        {/* Progress: "Pregunta 1 de 8" and one dot per question */}
        <div className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[15px] font-semibold" style={{ color: INK }}>
              {es ? "Pregunta" : "Question"} {at + 1} {es ? "de" : "of"} {defs.length}
            </span>
            <span className="text-[13px]" style={{ color: "#52525B" }}>
              {done} {es ? (done === 1 ? "contestada" : "contestadas") : "answered"}
            </span>
          </div>
          <div className="flex items-center gap-1.5" role="list" aria-label={es ? "Progreso" : "Progress"}>
            {defs.map((d, i) => {
              const ready = cardDone(d, answers[d.id]);
              const here = i === at;
              return (
                <button
                  key={d.id}
                  type="button"
                  role="listitem"
                  onClick={() => go(i)}
                  aria-label={`${es ? "Pregunta" : "Question"} ${i + 1}${ready ? (es ? ", contestada" : ", answered") : ""}`}
                  aria-current={here ? "step" : undefined}
                  className="h-2 rounded-full transition-all"
                  style={{ flex: here ? 2.2 : 1, background: here ? INK : ready ? "#16A34A" : "rgba(10,10,10,0.12)" }}
                />
              );
            })}
          </div>
        </div>

        {/* The card */}
        <div
          key={def.id}
          className="relative overflow-hidden rounded-[28px] bg-white p-6 md:p-10 flex flex-col gap-7"
          style={{ boxShadow: "0 1px 2px rgba(10,10,10,0.04), 0 24px 48px -26px rgba(10,10,10,0.28)", animation: "dash-fade .35s ease both" }}
        >
          {/* A thin green line on top: Sevrii's accent */}
          <span aria-hidden="true" className="absolute left-0 right-0 top-0 h-1" style={{ background: "linear-gradient(90deg, #16A34A, #4ADE80)" }} />
          <div className="flex flex-col gap-4">
            <div className="flex items-start justify-between gap-3">
              <span className="relative h-16 w-16 shrink-0" aria-hidden="true">
                <span className="absolute inset-0 rounded-[20px]" style={{ background: "#BBF7D0", transform: "rotate(-9deg) translate(-3px, 2px)" }} />
                <span className="absolute inset-0 rounded-[20px] flex items-center justify-center" style={{ background: "#FFFFFF", boxShadow: "inset 0 0 0 1px rgba(20,83,45,0.14)", color: DEEP_GREEN }}>
                  <CardIcon id={def.id} />
                </span>
              </span>
              <div className="flex flex-col items-end gap-1.5">
                <span className="inline-flex items-center gap-1.5 h-7 pl-2 pr-3 rounded-full text-[12px] font-semibold" style={{ background: INK, color: "#FFFFFF" }} title={mode === "new" ? (es ? "Necesaria para buscar tus ideas" : "Needed to find your ideas") : es ? "Necesaria para armar tu estrategia" : "Needed to build your strategy"}>
                  <SevriiMark size={14} color="#4ADE80" />
                  {es ? "Necesaria" : "Needed"}
                </span>
                {GROUP[def.id] && (
                  <span className="text-[11.5px] font-semibold uppercase tracking-[0.08em]" style={{ color: "#71717A" }}>
                    {GROUP[def.id][lang]}
                  </span>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <h2 className="text-[24px] md:text-[28px] font-medium leading-[1.2] tracking-[-0.01em]" style={{ color: INK }}>
                {def.title[lang]}
              </h2>
              <p className="text-[15px] leading-relaxed" style={{ color: "#52525B" }}>
                {def.help[lang]}
              </p>
              {WHY[def.id] && (
                <p className="flex items-start gap-2 text-[13px] leading-relaxed rounded-xl px-3 py-2 mt-1" style={{ background: "#F7FBF8", color: DEEP_GREEN }}>
                  <span aria-hidden="true" className="mt-[3px]">
                    <SevriiMark size={13} color="#16A34A" />
                  </span>
                  <span>
                    <b className="font-semibold">{es ? "Por qué te lo pregunto: " : "Why I ask: "}</b>
                    {WHY[def.id][lang]}
                  </span>
                </p>
              )}
            </div>
          </div>

          {def.choices && (
            <div className="flex flex-wrap gap-2.5" role="radiogroup" aria-label={def.title[lang]}>
              {def.choices.map((c) => {
                const on = a.c === c.id && !a.u;
                return (
                  <button
                    key={c.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => set({ c: c.id, u: false })}
                    className="h-12 px-6 rounded-full text-[15.5px] font-medium transition"
                    style={on ? { background: INK, color: "#fff" } : { background: "#fff", color: INK, boxShadow: `inset 0 0 0 1px ${LINE}` }}
                  >
                    {on ? "✓ " : ""}
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
              className="w-full rounded-2xl px-5 py-4 text-[16px] leading-relaxed outline-none resize-none focus:shadow-[inset_0_0_0_2px_#0A0A0A]"
              style={field}
            />
          )}

          {needsPlace && (
            <input
              value={a.p}
              onChange={(e) => set({ p: e.target.value, u: false })}
              placeholder={def.placeAlways ? (es ? "Ciudad y estado, o «en línea»" : "City and state, or \"online\"") : def.placeholder[lang]}
              className="w-full h-14 rounded-2xl px-5 text-[16px] outline-none focus:shadow-[inset_0_0_0_2px_#0A0A0A]"
              style={field}
            />
          )}

          {chips.length > 0 && (
            <div className="flex flex-col gap-2.5">
              <span className="text-[12.5px] font-medium" style={{ color: "#71717A" }}>
                {es ? "Toca para escoger (puedes escoger varias)" : "Tap to pick (you can pick several)"}
              </span>
              <div className="flex flex-wrap gap-2">
                {chips.map((h) => {
                  const on = picked.has(fold(h));
                  return (
                    <button
                      key={h}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleChip(h)}
                      className="h-10 px-4 rounded-full text-[14px] transition"
                      style={on ? { background: INK, color: "#fff", fontWeight: 600 } : { background: "#fff", color: INK, boxShadow: `inset 0 0 0 1px ${LINE}` }}
                    >
                      {on ? "✓ " : ""}
                      {h}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {def.unknown && (
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => set({ u: !a.u, v: a.u ? a.v : "", c: a.u ? a.c : "", p: a.u ? a.p : "" })}
                aria-pressed={a.u}
                className="self-start h-11 px-5 rounded-full text-[14.5px] font-medium transition"
                style={a.u ? { background: DEEP_GREEN, color: "#fff" } : { background: SOFT, color: DEEP_GREEN, boxShadow: "inset 0 0 0 1px rgba(20,83,45,0.18)" }}
              >
                {a.u ? "✓ " : ""}
                {def.unknown[lang]}
              </button>
              <span className="text-[13px]" style={{ color: "#71717A" }}>
                {a.u
                  ? es
                    ? "Queda como «no sé». No voy a suponer nada en su lugar."
                    : "Saved as \"don't know\". I won't assume anything instead."
                  : es
                    ? "Es una respuesta válida: si no lo sabes, tócalo."
                    : "It's a valid answer: if you don't know, tap it."}
              </span>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 pt-2" style={{ borderTop: `1px solid ${LINE}` }}>
            <button type="button" disabled={at === 0} onClick={() => go(at - 1)} className="h-11 px-2 mt-4 text-[14.5px] disabled:opacity-0" style={{ color: "#52525B" }}>
              ← {es ? "Atrás" : "Back"}
            </button>
            <button
              type="button"
              disabled={!ok || busy || (last && !allDone)}
              onClick={next}
              className="h-12 px-7 mt-4 rounded-full text-[15.5px] font-semibold transition"
              style={ok && !busy && (!last || allDone) ? { background: INK, color: "#fff" } : { background: "rgba(10,10,10,0.08)", color: "#A1A1AA" }}
            >
              {last ? (busy ? (es ? "Enviando…" : "Sending…") : mode === "new" ? (es ? "Ver mis propuestas" : "See my proposals") : es ? "Armar mi estrategia" : "Build my strategy") : es ? "Siguiente" : "Next"}
              {!last && " →"}
            </button>
          </div>
          {last && !allDone && (
            <p className="text-[13.5px] -mt-3" style={{ color: "#B45309" }}>
              {es ? "Te falta contestar alguna pregunta: toca los puntos de arriba para volver a ella." : "A question is still unanswered: tap the dots above to go back to it."}
            </p>
          )}
          {notice && <p className="text-[13.5px] -mt-3" style={{ color: "#B45309" }}>{notice}</p>}
        </div>

        <p className="text-[12.5px] text-center leading-relaxed" style={{ color: "#71717A" }}>
          {es ? "Todo lo que contestes queda guardado. Puedes volver a cualquier pregunta sin perder las demás." : "Everything you answer is saved. You can go back to any question without losing the others."}
        </p>
      </div>
    </div>
  );
}

// A simple line illustration per question (drawn here, nothing borrowed).
function CardIcon({ id }: { id: string }) {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const shapes: Record<string, React.ReactNode> = {
    talent: <path {...p} d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z" />,
    experience: (
      <>
        <rect {...p} x="3" y="7" width="18" height="13" rx="2.5" />
        <path {...p} d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M3 12.5h18" />
      </>
    ),
    likes: <path {...p} d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />,
    notWant: (
      <>
        <circle {...p} cx="12" cy="12" r="9" />
        <path {...p} d="M5.6 5.6l12.8 12.8" />
      </>
    ),
    resources: (
      <>
        <rect {...p} x="3" y="8" width="18" height="12" rx="2.5" />
        <path {...p} d="M8 8V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18M11 13v2h2v-2" />
      </>
    ),
    time: (
      <>
        <circle {...p} cx="12" cy="12" r="9" />
        <path {...p} d="M12 7v5l3 2" />
      </>
    ),
    delivery: (
      <>
        <circle {...p} cx="12" cy="12" r="9" />
        <path {...p} d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18" />
      </>
    ),
    income: (
      <>
        <circle {...p} cx="12" cy="12" r="9" />
        <path {...p} d="M15 9.2A3 3 0 0 0 12 7.8c-1.7 0-3 .9-3 2.2 0 3 6 1.6 6 4.4 0 1.3-1.3 2.2-3 2.2a3 3 0 0 1-3-1.4M12 6v12" />
      </>
    ),
    service: <path {...p} d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-2.5z" />,
    prices: (
      <>
        <path {...p} d="M3 12V4h8l10 10-8 8z" />
        <circle {...p} cx="7.5" cy="8" r="1.4" />
      </>
    ),
    costs: <path {...p} d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3" />,
    clients: (
      <>
        <circle {...p} cx="9" cy="8" r="3" />
        <path {...p} d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
        <circle {...p} cx="17" cy="9" r="2.4" />
        <path {...p} d="M16.5 14.2c2.6.4 4.5 2.7 4.5 5.8" />
      </>
    ),
    goal: (
      <>
        <circle {...p} cx="12" cy="12" r="9" />
        <circle {...p} cx="12" cy="12" r="5" />
        <circle {...p} cx="12" cy="12" r="1" />
      </>
    ),
  };
  const shape = shapes[id] ?? shapes[id === "hours" ? "time" : id === "assets" ? "resources" : "talent"];
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">
      {shape}
    </svg>
  );
}
