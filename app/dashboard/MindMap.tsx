"use client";

// A strategy shown as a top-down mind map:
//   the main idea on top → its groups in a row below → each group's parts
//   hanging under it.
// Everything invites a tap: groups fold and unfold, each part opens its full
// detail in a side panel (a sheet from the bottom on phones) with "previous /
// next" to walk through the whole strategy, and the next part that needs the
// owner is marked "Empieza aquí".

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ACCENT, RING } from "@/lib/brand";
import { useLang } from "@/components/LangProvider";

export type MindTone = "idle" | "done" | "warn" | "active";

export type MindNode = {
  id: string;
  label: string; // small caps line, e.g. "Paquetes y precios"
  title: string; // the main idea of the part, one or two lines
  summary?: string; // optional short line under the title
  tone?: MindTone; // done = approved (green), warn = needs attention
  badge?: string; // tiny status text, e.g. "Aprobado"
  group?: string; // id of the group it hangs from (see `groups`)
  step?: boolean; // a part the owner has to approve (counts in "x de y listas")
  detail?: ReactNode; // everything else, shown when the part is opened
};

export type MindGroup = { id: string; label: string; hint?: string };

export type MindCenter = {
  eyebrow: string;
  title: string;
  subtitle?: string;
  footer?: ReactNode; // e.g. progress or the main action
};

const LINE = "rgba(255,255,255,0.16)";
const CARD = "#101010";
const toneColor = (t?: MindTone) => (t === "done" ? ACCENT : t === "warn" ? "#f5c451" : t === "active" ? "#ffffff" : "#9a9a9a");

const TEXT = {
  es: {
    parts: (n: number) => `${n} ${n === 1 ? "parte" : "partes"}`,
    approved: (n: number, total: number) => `${n} de ${total} listas`,
    open: "Toca para desplegar",
    close: "Ocultar",
    see: "Ver detalle",
    start: "Empieza aquí",
    prev: "Anterior",
    next: "Siguiente",
    closePanel: "Cerrar",
    of: (a: number, b: number) => `${a} de ${b}`,
  },
  en: {
    parts: (n: number) => `${n} ${n === 1 ? "part" : "parts"}`,
    approved: (n: number, total: number) => `${n} of ${total} ready`,
    open: "Tap to open",
    close: "Hide",
    see: "See details",
    start: "Start here",
    prev: "Previous",
    next: "Next",
    closePanel: "Close",
    of: (a: number, b: number) => `${a} of ${b}`,
  },
};

export default function MindMap({
  center,
  nodes,
  groups,
  initialOpen,
  openId: controlledOpen,
  onOpenChange,
  guide = true,
}: {
  center: MindCenter;
  nodes: MindNode[];
  groups?: MindGroup[];
  initialOpen?: string | null;
  openId?: string | null;
  onOpenChange?: (id: string | null) => void;
  // false: no "Empieza aquí" tag (the parts are approved somewhere else).
  guide?: boolean;
}) {
  const lang = useLang();
  const t = TEXT[lang];
  const [innerOpen, setInnerOpen] = useState<string | null>(initialOpen ?? null);
  const open = controlledOpen !== undefined ? controlledOpen : innerOpen;
  const setOpen = useCallback(
    (id: string | null) => {
      if (controlledOpen === undefined) setInnerOpen(id);
      onOpenChange?.(id);
    },
    [controlledOpen, onOpenChange]
  );

  // Groups in order; parts without a known group go to a last "more" group.
  const cols = useMemo(() => {
    const list = (groups && groups.length ? groups : [{ id: "_all", label: "" }]).map((g) => ({
      ...g,
      nodes: nodes.filter((n) => (groups && groups.length ? n.group === g.id : true)),
    }));
    if (groups && groups.length) {
      const known = new Set(groups.map((g) => g.id));
      const rest = nodes.filter((n) => !n.group || !known.has(n.group));
      if (rest.length) list.push({ id: "_rest", label: lang === "es" ? "Más" : "More", nodes: rest });
    }
    return list.filter((g) => g.nodes.length > 0);
  }, [groups, nodes, lang]);

  // The next part that needs the owner gets the "start here" mark.
  const steps = nodes.filter((n) => n.step);
  const nextId = guide ? (steps.find((n) => n.tone !== "done")?.id ?? null) : null;

  // Unfolded groups: only those with something left to approve.
  const [unfolded, setUnfolded] = useState<Set<string>>(() => {
    const pending = cols.filter((g) => g.nodes.some((n) => n.step && n.tone !== "done")).map((g) => g.id);
    // Nothing pending: everything starts folded, inviting a tap ("Toca para desplegar").
    return new Set(pending);
  });
  const toggleGroup = (id: string) =>
    setUnfolded((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  // Opening a part unfolds its group.
  useEffect(() => {
    if (!open) return;
    const g = cols.find((c) => c.nodes.some((n) => n.id === open));
    if (g && !unfolded.has(g.id)) setUnfolded((cur) => new Set(cur).add(g.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const order = cols.flatMap((c) => c.nodes);
  const selected = order.find((n) => n.id === open) ?? null;
  const index = selected ? order.indexOf(selected) : -1;

  return (
    <div className="w-full">
      <Tree center={center} cols={cols} unfolded={unfolded} onToggleGroup={toggleGroup} open={open} nextId={nextId} onOpen={(id) => setOpen(id)} t={t} />
      {selected && (
        <DetailPanel
          node={selected}
          position={t.of(index + 1, order.length)}
          onClose={() => setOpen(null)}
          onPrev={index > 0 ? () => setOpen(order[index - 1].id) : undefined}
          onNext={index < order.length - 1 ? () => setOpen(order[index + 1].id) : undefined}
          t={t}
        />
      )}
    </div>
  );
}

type Col = MindGroup & { nodes: MindNode[] };
type T = (typeof TEXT)["es"];

function Tree({
  center,
  cols,
  unfolded,
  onToggleGroup,
  open,
  nextId,
  onOpen,
  t,
}: {
  center: MindCenter;
  cols: Col[];
  unfolded: Set<string>;
  onToggleGroup: (id: string) => void;
  open: string | null;
  nextId: string | null;
  onOpen: (id: string) => void;
  t: T;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const headRefs = useRef(new Map<string, HTMLDivElement>());
  const [lines, setLines] = useState<{ id: string; d: string; done: boolean }[]>([]);
  const [box, setBox] = useState({ w: 0, h: 0 });

  // Elbow lines from the main idea down to each group (wide screens only).
  const measure = useCallback(() => {
    const w = wrap.current;
    const r = rootRef.current;
    if (!w || !r) return;
    const W = w.getBoundingClientRect();
    const R = r.getBoundingClientRect();
    const x0 = R.left + R.width / 2 - W.left;
    const y0 = R.bottom - W.top;
    const out: { id: string; d: string; done: boolean }[] = [];
    for (const c of cols) {
      const el = headRefs.current.get(c.id);
      if (!el) continue;
      const H = el.getBoundingClientRect();
      const x1 = H.left + H.width / 2 - W.left;
      const y1 = H.top - W.top;
      const mid = y0 + (y1 - y0) / 2;
      const rad = Math.min(12, Math.abs(x1 - x0) / 2, (y1 - y0) / 4);
      const dir = x1 > x0 ? 1 : -1;
      const d =
        Math.abs(x1 - x0) < 1
          ? `M ${x0} ${y0} V ${y1}`
          : `M ${x0} ${y0} V ${mid - rad} Q ${x0} ${mid} ${x0 + dir * rad} ${mid} H ${x1 - dir * rad} Q ${x1} ${mid} ${x1} ${mid + rad} V ${y1}`;
      const st = c.nodes.filter((n) => n.step);
      out.push({ id: c.id, d, done: st.length > 0 && st.every((n) => n.tone === "done") });
    }
    setLines(out);
    setBox({ w: W.width, h: W.height });
  }, [cols]);

  useLayoutEffect(() => {
    measure();
  }, [measure, unfolded]);
  useEffect(() => {
    const ro = new ResizeObserver(() => measure());
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  }, [measure]);

  const n = cols.length;
  const gridCols = n >= 4 ? "lg:grid-cols-4" : n === 3 ? "lg:grid-cols-3" : n === 2 ? "lg:grid-cols-2" : "lg:grid-cols-1";

  return (
    <div ref={wrap} className="relative">
      <svg className="hidden lg:block absolute inset-0 pointer-events-none" width={box.w} height={box.h} aria-hidden="true">
        {lines.map((l) => (
          <path key={l.id} d={l.d} fill="none" stroke={l.done ? "rgba(125,191,156,0.6)" : LINE} strokeWidth={1.3} />
        ))}
      </svg>

      {/* Main idea */}
      <div ref={rootRef} className="relative z-[1] mx-auto max-w-[560px]">
        <RootCard center={center} />
      </div>

      {/* Phones: a spine from the main idea down through the groups */}
      <div className="lg:hidden mx-auto h-6 w-px" style={{ background: LINE }} />

      {/* Groups */}
      <div className={`relative z-[1] grid grid-cols-1 ${gridCols} gap-4 lg:gap-5 lg:mt-14`}>
        {cols.map((c) => {
          const isOpen = unfolded.has(c.id);
          const stepNodes = c.nodes.filter((x) => x.step);
          const done = stepNodes.filter((x) => x.tone === "done").length;
          const hasStatus = stepNodes.length > 0;
          const allDone = hasStatus && done === stepNodes.length;
          return (
            <div key={c.id} className="flex flex-col">
              <div
                ref={(el) => {
                  if (el) headRefs.current.set(c.id, el);
                  else headRefs.current.delete(c.id);
                }}
              >
                <button
                  type="button"
                  onClick={() => onToggleGroup(c.id)}
                  aria-expanded={isOpen}
                  className="group w-full rounded-2xl px-4 py-3.5 flex items-center gap-3 text-left transition-all duration-200 hover:-translate-y-0.5"
                  style={{
                    background: isOpen ? "#151515" : CARD,
                    boxShadow: `0 0 0 1px ${allDone && hasStatus ? "rgba(125,191,156,0.45)" : isOpen ? "rgba(255,255,255,0.22)" : LINE}`,
                  }}
                >
                  <span
                    className="h-9 w-9 shrink-0 rounded-full flex items-center justify-center text-[13px] font-semibold"
                    style={{ background: allDone && hasStatus ? "rgba(46,122,85,0.30)" : "rgba(255,255,255,0.06)", color: allDone && hasStatus ? ACCENT : "#e5e5e5" }}
                  >
                    {allDone && hasStatus ? <Check /> : c.nodes.length}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-semibold text-white leading-tight">{c.label}</span>
                    <span className="block text-[12px] text-[#9a9a9a] mt-0.5">
                      {hasStatus ? t.approved(done, stepNodes.length) : t.parts(c.nodes.length)}
                      {!isOpen && <span className="text-[#d4d4d4]"> · {t.open}</span>}
                    </span>
                  </span>
                  <Chevron open={isOpen} />
                </button>
              </div>

              {/* Its parts, hanging from a rail */}
              <div className="grid transition-[grid-template-rows] duration-300 ease-out" style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}>
                <div className="overflow-hidden">
                  <div className="ml-[22px] pl-4 pt-1 pb-1" style={{ borderLeft: `1px solid ${allDone && hasStatus ? "rgba(125,191,156,0.45)" : LINE}` }}>
                    {c.nodes.map((node) => (
                      <div key={node.id} className="relative pt-3">
                        <span className="absolute -left-4 top-[30px] h-px w-4" style={{ background: node.tone === "done" ? "rgba(125,191,156,0.55)" : LINE }} />
                        <PartCard node={node} active={open === node.id} isNext={nextId === node.id} onOpen={() => onOpen(node.id)} t={t} />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RootCard({ center }: { center: MindCenter }) {
  return (
    <div
      className="rounded-[24px] px-6 py-6 text-center flex flex-col items-center gap-2"
      style={{
        background: "radial-gradient(120% 140% at 50% 0%, rgba(46,122,85,0.32) 0%, rgba(16,16,16,1) 72%)",
        boxShadow: `0 0 0 1px ${RING}, 0 24px 60px -24px rgba(46,122,85,0.55)`,
      }}
    >
      <span className="text-[11px] font-semibold uppercase tracking-[0.1em]" style={{ color: ACCENT }}>
        {center.eyebrow}
      </span>
      <span className="text-[20px] md:text-[22px] font-semibold text-white leading-snug">{center.title}</span>
      {center.subtitle && <span className="text-[13.5px] text-[#a1a1a1] leading-relaxed max-w-[440px] line-clamp-2">{center.subtitle}</span>}
      {center.footer && <div className="mt-2 w-full flex justify-center">{center.footer}</div>}
    </div>
  );
}

function PartCard({ node, active, isNext, onOpen, t }: { node: MindNode; active: boolean; isNext: boolean; onOpen: () => void; t: T }) {
  const c = toneColor(node.tone);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group relative w-full text-left rounded-2xl px-4 py-3.5 transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#161616] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
      style={{
        background: active ? "#171717" : CARD,
        boxShadow: `0 0 0 1px ${active ? "rgba(255,255,255,0.35)" : isNext ? "rgba(245,196,81,0.55)" : node.tone === "done" ? "rgba(125,191,156,0.35)" : LINE}`,
      }}
    >
      {isNext && (
        <span className="absolute -top-2.5 right-3 text-[10.5px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "#f5c451", color: "#1a1300" }}>
          <span className="inline-block h-1.5 w-1.5 rounded-full mr-1 align-middle animate-pulse" style={{ background: "#1a1300" }} />
          {t.start}
        </span>
      )}
      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: c }} />
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] truncate" style={{ color: c }}>
          {node.label}
        </span>
        {node.badge && <span className="text-[10.5px] text-[#8e8e8e] shrink-0">· {node.badge}</span>}
      </div>
      <div className="text-[14.5px] text-white font-medium leading-snug mt-1.5 line-clamp-2">{node.title}</div>
      {node.summary && <div className="text-[12.5px] text-[#9a9a9a] leading-snug mt-1 line-clamp-2">{node.summary}</div>}
      <div className="mt-2.5 flex items-center gap-1 text-[12px] font-medium text-[#cfcfcf] group-hover:text-white">
        {t.see}
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="transition-transform group-hover:translate-x-0.5" aria-hidden="true">
          <path d="M9 6l6 6-6 6" />
        </svg>
      </div>
    </button>
  );
}

// The full detail of a part: a panel on the right (bottom sheet on phones),
// with previous / next to walk through every part.
function DetailPanel({
  node,
  position,
  onClose,
  onPrev,
  onNext,
  t,
}: {
  node: MindNode;
  position: string;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  t: T;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" && onNext) onNext();
      else if (e.key === "ArrowLeft" && onPrev) onPrev();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose, onNext, onPrev]);
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [node.id]);

  const c = toneColor(node.tone === "idle" || !node.tone ? "active" : node.tone);
  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label={node.label}>
      <button type="button" aria-label={t.closePanel} onClick={onClose} className="absolute inset-0 bg-black/60 backdrop-blur-[2px] cursor-default" />
      <div
        className="absolute bottom-0 left-0 right-0 max-h-[88dvh] rounded-t-[22px] lg:rounded-none lg:top-0 lg:left-auto lg:w-[560px] lg:max-h-none flex flex-col animate-[sheetIn_.22s_ease-out]"
        style={{ background: "#0c0c0c", boxShadow: "0 0 0 1px rgba(255,255,255,0.10), 0 -20px 60px rgba(0,0,0,0.6)" }}
      >
        <div className="lg:hidden mx-auto mt-2.5 h-1 w-10 rounded-full bg-white/20" />
        <div className="px-5 pt-4 pb-3 flex items-start gap-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: c }}>
                {node.label}
              </span>
              {node.badge && <span className="text-[11px] text-[#8e8e8e]">· {node.badge}</span>}
              <span className="text-[11px] text-[#6f6f6f] ml-auto">{position}</span>
            </div>
            <div className="text-[18px] font-semibold text-white leading-snug mt-1">{node.title}</div>
          </div>
          <button type="button" onClick={onClose} aria-label={t.closePanel} className="h-9 w-9 shrink-0 rounded-full flex items-center justify-center text-[#a1a1a1] hover:text-white hover:bg-white/[0.07]">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div ref={bodyRef} className="flex-1 min-h-0 overflow-y-auto px-5 py-5">
          {node.detail ?? (node.summary ? <p className="text-[14px] text-[#d4d4d4] leading-relaxed">{node.summary}</p> : null)}
        </div>
        <div className="px-5 py-3 flex items-center justify-between gap-3" style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
          <button type="button" disabled={!onPrev} onClick={onPrev} className="h-10 px-4 rounded-full text-[13.5px] text-[#d4d4d4] hover:text-white disabled:opacity-30" style={{ background: "rgba(255,255,255,0.06)" }}>
            ← {t.prev}
          </button>
          <button type="button" disabled={!onNext} onClick={onNext} className="h-10 px-4 rounded-full text-[13.5px] font-medium text-white disabled:opacity-30" style={{ background: "rgba(255,255,255,0.12)" }}>
            {t.next} →
          </button>
        </div>
      </div>
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#d4d4d4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 transition-transform duration-200" style={{ transform: open ? "rotate(180deg)" : "none" }} aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function Check() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}
