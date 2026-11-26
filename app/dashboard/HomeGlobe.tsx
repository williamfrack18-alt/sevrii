"use client";

import { useEffect, useRef, useState } from "react";
import { GLOBE_POINTS } from "@/lib/globePoints";

// Inicio's background: a dotted globe that turns slowly, can be spun by
// dragging (mouse or finger), and shows where visitors came from as green
// points that pulse; hovering or tapping one says the city and how many.

export type GlobePlace = { lat: number; lng: number; n: number; city: string; country: string };

const RAD = Math.PI / 180;
let LAND: Float32Array | null = null;
function land(): Float32Array {
  if (LAND) return LAND;
  const parts = GLOBE_POINTS.split(";");
  const a = new Float32Array(parts.length * 2);
  parts.forEach((p, i) => {
    const [la, ln] = p.split(",");
    a[i * 2] = (Number(la) / 10) * RAD;
    a[i * 2 + 1] = (Number(ln) / 10) * RAD;
  });
  return (LAND = a);
}

export default function HomeGlobe({ places, label, visitors }: { places: GlobePlace[]; label: string; visitors: (n: number) => string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const placesRef = useRef(places);
  placesRef.current = places;
  // Start facing the Americas, a little tilted, like a real globe.
  const view = useRef({ lng: 90, lat: 18, vel: 0.06, drag: null as null | { x: number; y: number; lng: number; lat: number; t: number; moved: boolean } });
  const screen = useRef<{ x: number; y: number; r: number; p: GlobePlace }[]>([]);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);

  useEffect(() => {
    const el = canvas.current;
    const box = wrap.current;
    if (!el || !box) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    const pts = land();
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let visible = true;
    let size = 0;
    let dpr = 1;

    const resize = () => {
      size = box.clientWidth;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      el.width = Math.round(size * dpr);
      el.height = Math.round(size * dpr);
      el.style.width = `${size}px`;
      el.style.height = `${size}px`;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(box);
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(box);

    const draw = (time: number) => {
      raf = requestAnimationFrame(draw);
      if (!visible || document.visibilityState !== "visible" || !size) return;
      const v = view.current;
      if (!v.drag && !still) v.lng = (v.lng + v.vel) % 360;
      const r = size * 0.46;
      const cx = size / 2;
      const cy = size / 2;
      const l0 = v.lng * RAD;
      const p0 = v.lat * RAD;
      const sp = Math.sin(p0);
      const cp = Math.cos(p0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);

      // The sphere's soft edge
      const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r);
      g.addColorStop(0, "rgba(255,255,255,0)");
      g.addColorStop(1, "rgba(10,10,10,0.035)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();

      // Land dots (front side only), fainter toward the edge
      const dot = Math.max(1.7, size / 290);
      for (let i = 0; i < pts.length; i += 2) {
        const lat = pts[i];
        const lng = pts[i + 1] + l0;
        const cl = Math.cos(lat);
        const x = cl * Math.sin(lng);
        const yy = Math.sin(lat);
        const z0 = cl * Math.cos(lng);
        const y = yy * cp - z0 * sp;
        const z = yy * sp + z0 * cp;
        if (z <= 0) continue;
        ctx.globalAlpha = 0.35 + 0.65 * z;
        ctx.fillStyle = "#A3A39C";
        ctx.fillRect(cx + x * r - dot / 2, cy - y * r - dot / 2, dot, dot);
      }
      ctx.globalAlpha = 1;

      // Visitors: green points with a pulse
      const list = placesRef.current;
      const top = Math.max(1, ...list.map((p) => p.n));
      const out: typeof screen.current = [];
      const pulse = (time % 2000) / 2000;
      for (const p of list) {
        const lat = p.lat * RAD;
        const lng = p.lng * RAD + l0;
        const cl = Math.cos(lat);
        const x = cl * Math.sin(lng);
        const yy = Math.sin(lat);
        const z0 = cl * Math.cos(lng);
        const y = yy * cp - z0 * sp;
        const z = yy * sp + z0 * cp;
        if (z <= 0.05) continue;
        const sx = cx + x * r;
        const sy = cy - y * r;
        const rr = (2.2 + 3.2 * Math.sqrt(p.n / top)) * Math.max(0.8, size / 520);
        if (!still) {
          ctx.globalAlpha = (1 - pulse) * 0.35 * z;
          ctx.fillStyle = "#16A34A";
          ctx.beginPath();
          ctx.arc(sx, sy, rr * (1.2 + pulse * 2.2), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 0.6 + 0.4 * z;
        ctx.fillStyle = "#16A34A";
        ctx.beginPath();
        ctx.arc(sx, sy, rr, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.2;
        ctx.stroke();
        out.push({ x: sx, y: sy, r: rr, p });
      }
      screen.current = out;
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
    };
  }, []);

  // The visitor point under the pointer, if any.
  const hit = (cx: number, cy: number) => {
    const rect = canvas.current?.getBoundingClientRect();
    if (!rect) return null;
    const x = cx - rect.left;
    const y = cy - rect.top;
    let best: { x: number; y: number; p: GlobePlace } | null = null;
    let bd = Infinity;
    for (const s of screen.current) {
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < Math.max(12, s.r + 6) && d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  };
  const showTip = (cx: number, cy: number) => {
    const b = hit(cx, cy);
    setTip(b ? { x: b.x, y: b.y, text: `${b.p.city || b.p.country || ""}${b.p.city || b.p.country ? " · " : ""}${visitors(b.p.n)}` } : null);
    return Boolean(b);
  };

  return (
    <div ref={wrap} className="relative w-full aspect-square select-none">
      <canvas
        ref={canvas}
        role="img"
        aria-label={label}
        className="block touch-none cursor-grab active:cursor-grabbing"
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          const v = view.current;
          v.drag = { x: e.clientX, y: e.clientY, lng: v.lng, lat: v.lat, t: performance.now(), moved: false };
        }}
        onPointerMove={(e) => {
          const v = view.current;
          if (v.drag) {
            const dx = e.clientX - v.drag.x;
            const dy = e.clientY - v.drag.y;
            if (Math.abs(dx) + Math.abs(dy) > 3) v.drag.moved = true;
            v.lng = v.drag.lng + dx * 0.35;
            v.lat = Math.max(-60, Math.min(60, v.drag.lat + dy * 0.35));
            setTip(null);
          } else if (e.pointerType === "mouse") showTip(e.clientX, e.clientY);
        }}
        onPointerUp={(e) => {
          const v = view.current;
          const d = v.drag;
          v.drag = null;
          // A tap (no drag) on a point shows its city.
          if (d && !d.moved) showTip(e.clientX, e.clientY);
        }}
        onPointerLeave={(e) => e.pointerType === "mouse" && !view.current.drag && setTip(null)}
      />
      {tip && (
        <div
          className="pointer-events-none absolute z-[2] -translate-x-1/2 -translate-y-[calc(100%+10px)] whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium text-white"
          style={{ left: tip.x, top: tip.y, background: "#0A0A0A", boxShadow: "0 6px 16px -6px rgba(0,0,0,.4)" }}
        >
          {tip.text}
        </div>
      )}
    </div>
  );
}
