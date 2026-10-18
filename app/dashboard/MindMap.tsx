"use client";

// A strategy shown as a mind map: one idea in the middle and its branches
// around it, joined by soft curves. Desktop: branches on both sides of the
// center. Mobile: the center on top and the branches as a vertical tree.
// Tapping a branch opens its full detail (below the map on desktop, inline
// on mobile).

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ACCENT, RING } from "@/lib/brand";

export type MindTone = "idle" | "done" | "warn" | "active";

export type MindNode = {
  id: string;
  label: string; // small caps line, e.g. "Paquetes y precios"
  title: string; // the main idea of the branch, one or two lines
  summary?: string; // optional short line under the title
  tone?: MindTone; // done = approved (green), warn = needs attention
  badge?: string; // tiny status text, e.g. "Aprobado"
  detail?: ReactNode; // everything else, shown when the branch is opened
};

export type MindCenter = {
  eyebrow: string;
  title: string;
  subtitle?: string;
  footer?: ReactNode; // e.g. progress or the main action
};

const LINE = "rgba(255,255,255,0.14)";
const CARD = "#101010";

const toneColor = (t?: MindTone) => (t === "done" ? ACCENT : t === "warn" ? "#f5c451" : t === "active" ? "#ffffff" : "#8e8e8e");

export default function MindMap({
  center,
  nodes,
  initialOpen,
  openId: controlledOpen,
  onOpenChange,
}: {
  center: MindCenter;
  nodes: MindNode[];
  initialOpen?: string | null;
  openId?: string | null;
  onOpenChange?: (id: string | null) => void;
}) {
  const [innerOpen, setInnerOpen] = useState<string | null>(initialOpen ?? null);
  const open = controlledOpen !== undefined ? controlledOpen : innerOpen;
  const setOpen = useCallback(
    (id: string | null) => {
      if (controlledOpen === undefined) setInnerOpen(id);
      onOpenChange?.(id);
    },
    [controlledOpen, onOpenChange]
  );
  const toggle = (id: string) => setOpen(open === id ? null : id);
  const selected = nodes.find((n) => n.id === open) ?? null;

  // Left and right columns, alternating so both sides stay balanced.
  const left = nodes.filter((_, i) => i % 2 === 0);
  const right = nodes.filter((_, i) => i % 2 === 1);

  return (
    <div className="w-full">
      {/* Desktop map */}
      <DesktopMap center={center} left={left} right={right} open={open} onToggle={toggle} />
      {selected?.detail && (
        <div className="hidden lg:block mt-5 rounded-2xl p-6" style={{ background: CARD, boxShadow: `0 0 0 1px ${LINE}` }}>
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: toneColor(selected.tone === "idle" ? "active" : selected.tone) }}>
                {selected.label}
              </div>
              <div className="text-[18px] font-semibold text-white mt-1 leading-snug">{selected.title}</div>
            </div>
            <button type="button" onClick={() => setOpen(null)} aria-label="Cerrar" className="h-8 w-8 rounded-full flex items-center justify-center text-[#a1a1a1] hover:text-white hover:bg-white/[0.06]">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          {selected.detail}
        </div>
      )}

      {/* Mobile tree */}
      <MobileTree center={center} nodes={nodes} open={open} onToggle={toggle} />
    </div>
  );
}

function CenterCard({ center }: { center: MindCenter }) {
  return (
    <div
      className="rounded-[22px] px-6 py-6 text-center flex flex-col items-center gap-2"
      style={{
        background: "radial-gradient(120% 120% at 50% 0%, rgba(46,122,85,0.30) 0%, rgba(16,16,16,1) 70%)",
        boxShadow: `0 0 0 1px ${RING}, 0 20px 60px -20px rgba(46,122,85,0.45)`,
      }}
    >
      <span className="text-[11px] font-semibold uppercase tracking-[0.1em]" style={{ color: ACCENT }}>
        {center.eyebrow}
      </span>
      <span className="text-[19px] md:text-[21px] font-semibold text-white leading-snug">{center.title}</span>
      {center.subtitle && <span className="text-[13.5px] text-[#a1a1a1] leading-relaxed max-w-[320px]">{center.subtitle}</span>}
      {center.footer && <div className="mt-2 w-full flex justify-center">{center.footer}</div>}
    </div>
  );
}

function NodeCard({ node, open, onToggle, side }: { node: MindNode; open: boolean; onToggle: () => void; side?: "left" | "right" }) {
  const c = toneColor(node.tone);
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="group w-full text-left rounded-2xl px-4 py-3.5 transition-colors"
      style={{
        background: open ? "#161616" : CARD,
        boxShadow: `0 0 0 1px ${open ? "rgba(255,255,255,0.28)" : node.tone === "done" ? "rgba(125,191,156,0.35)" : LINE}`,
        textAlign: side === "left" ? "right" : "left",
      }}
    >
      <div className={`flex items-center gap-2 ${side === "left" ? "justify-end" : ""}`}>
        <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: c }} />
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em]" style={{ color: c }}>
          {node.label}
        </span>
        {node.badge && <span className="text-[10.5px] text-[#8e8e8e]">· {node.badge}</span>}
      </div>
      <div className="text-[14.5px] text-white font-medium leading-snug mt-1.5 line-clamp-2">{node.title}</div>
      {node.summary && <div className="text-[12.5px] text-[#9a9a9a] leading-snug mt-1 line-clamp-2">{node.summary}</div>}
    </button>
  );
}

function DesktopMap({
  center,
  left,
  right,
  open,
  onToggle,
}: {
  center: MindCenter;
  left: MindNode[];
  right: MindNode[];
  open: string | null;
  onToggle: (id: string) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const centerRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef(new Map<string, HTMLDivElement>());
  const [paths, setPaths] = useState<{ id: string; d: string; done: boolean; on: boolean }[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const measure = useCallback(() => {
    const root = wrap.current;
    const mid = centerRef.current;
    if (!root || !mid) return;
    const r = root.getBoundingClientRect();
    const m = mid.getBoundingClientRect();
    const next: { id: string; d: string; done: boolean; on: boolean }[] = [];
    const add = (n: MindNode, side: "left" | "right") => {
      const el = nodeRefs.current.get(n.id);
      if (!el) return;
      const b = el.getBoundingClientRect();
      const y2 = b.top + b.height / 2 - r.top;
      const y1 = Math.min(Math.max(y2, m.top - r.top + 24), m.bottom - r.top - 24);
      const x1 = side === "left" ? m.left - r.left : m.right - r.left;
      const x2 = side === "left" ? b.right - r.left : b.left - r.left;
      const dx = (x2 - x1) * 0.55;
      next.push({ id: n.id, d: `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`, done: n.tone === "done", on: open === n.id });
    };
    left.forEach((n) => add(n, "left"));
    right.forEach((n) => add(n, "right"));
    setPaths(next);
    setSize({ w: r.width, h: r.height });
  }, [left, right, open]);

  useLayoutEffect(() => {
    measure();
  }, [measure]);
  useEffect(() => {
    const ro = new ResizeObserver(() => measure());
    if (wrap.current) ro.observe(wrap.current);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  const column = (list: MindNode[], side: "left" | "right") => (
    <div className="flex flex-col justify-center gap-4 py-2">
      {list.map((n) => (
        <div
          key={n.id}
          ref={(el) => {
            if (el) nodeRefs.current.set(n.id, el);
            else nodeRefs.current.delete(n.id);
          }}
        >
          <NodeCard node={n} side={side} open={open === n.id} onToggle={() => onToggle(n.id)} />
        </div>
      ))}
    </div>
  );

  return (
    <div ref={wrap} className="hidden lg:grid relative items-center gap-x-16" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(260px,320px) minmax(0,1fr)" }}>
      <svg className="absolute inset-0 pointer-events-none" width={size.w} height={size.h} aria-hidden="true">
        {paths.map((p) => (
          <path key={p.id} d={p.d} fill="none" stroke={p.on ? "rgba(255,255,255,0.55)" : p.done ? "rgba(125,191,156,0.55)" : LINE} strokeWidth={p.on ? 1.6 : 1.2} />
        ))}
      </svg>
      {column(left, "left")}
      <div ref={centerRef} className="relative z-[1]">
        <CenterCard center={center} />
      </div>
      {column(right, "right")}
    </div>
  );
}

function MobileTree({ center, nodes, open, onToggle }: { center: MindCenter; nodes: MindNode[]; open: string | null; onToggle: (id: string) => void }) {
  return (
    <div className="lg:hidden">
      <CenterCard center={center} />
      <div className="relative mt-1 ml-4 pl-5" style={{ borderLeft: `1px solid ${LINE}` }}>
        {nodes.map((n) => (
          <div key={n.id} className="relative pt-3">
            {/* branch from the spine */}
            <span className="absolute -left-5 top-[34px] h-px w-5" style={{ background: n.tone === "done" ? "rgba(125,191,156,0.55)" : LINE }} />
            <NodeCard node={n} open={open === n.id} onToggle={() => onToggle(n.id)} />
            {open === n.id && n.detail && (
              <div className="mt-2 rounded-2xl p-4" style={{ background: CARD, boxShadow: `0 0 0 1px ${LINE}` }}>
                {n.detail}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
