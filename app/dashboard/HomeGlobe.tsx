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

// The whole sphere as faint dots (the sea), so the globe has its shape.
let SEA: Float32Array | null = null;
function sea(): Float32Array {
  if (SEA) return SEA;
  const N = 2600;
  const a = new Float32Array(N * 2);
  const g = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2;
    a[i * 2] = Math.asin(y);
    a[i * 2 + 1] = ((i * g) % (Math.PI * 2)) - Math.PI;
  }
  return (SEA = a);
}

export default function HomeGlobe({ places, label, visitors, dark = false }: { places: GlobePlace[]; label: string; visitors: (n: number) => string; dark?: boolean }) {
  // Colors for a light page or for the starry dark green.
  const C = dark
    ? { halo: "rgba(110,220,180,0.16)", ball: ["#163c34", "#0c2621", "#05110e"], rim: "rgba(160,240,210,0.18)", sea: "#3E6359", land: ["#D7EDE5", "#A9CBBF"], spot: "#34C77B", ring: "rgba(255,255,255,0.85)" }
    : { halo: "rgba(22,163,74,0.10)", ball: ["#FFFFFF", "#FAFAF8", "#ECECE8"], rim: "rgba(10,10,10,0.06)", sea: "#C9C9C3", land: ["#7E7E77", "#97978F"], spot: "#16A34A", ring: "#fff" };
  const colors = useRef(C);
  colors.current = C;
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const placesRef = useRef(places);
  placesRef.current = places;
  // Start facing the Americas, a little tilted, like a real globe.
  const view = useRef({ lng: 90, lat: 18, vel: 0.05, spin: 0, last: { x: 0, t: 0 }, drag: null as null | { x: number; y: number; lng: number; lat: number; t: number; moved: boolean } });
  const screen = useRef<{ x: number; y: number; r: number; p: GlobePlace }[]>([]);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);

  useEffect(() => {
    const el = canvas.current;
    const box = wrap.current;
    if (!el || !box) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    const pts = land();
    const seaPts = sea();
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
      if (!v.drag && !still) {
        v.lng = (v.lng + v.vel + v.spin) % 360;
        v.spin *= 0.94;
        if (Math.abs(v.spin) < 0.001) v.spin = 0;
      }
      const r = size * 0.46;
      const cx = size / 2;
      const cy = size / 2;
      const l0 = v.lng * RAD;
      const p0 = v.lat * RAD;
      const sp = Math.sin(p0);
      const cp = Math.cos(p0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);

      // A soft halo around the globe
      const halo = ctx.createRadialGradient(cx, cy, r * 0.92, cx, cy, r * 1.12);
      const K = colors.current;
      halo.addColorStop(0, K.halo);
      halo.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.12, 0, Math.PI * 2);
      ctx.fill();

      // The ball: white, lit from the top left, a little shade on the far side
      const ball = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.05, cx, cy, r);
      ball.addColorStop(0, K.ball[0]);
      ball.addColorStop(0.65, K.ball[1]);
      ball.addColorStop(1, K.ball[2]);
      ctx.fillStyle = ball;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = K.rim;
      ctx.lineWidth = 1;
      ctx.stroke();

      const project = (lat: number, lng0: number) => {
        const lng = lng0 + l0;
        const cl = Math.cos(lat);
        const x = cl * Math.sin(lng);
        const yy = Math.sin(lat);
        const z0 = cl * Math.cos(lng);
        return { x, y: yy * cp - z0 * sp, z: yy * sp + z0 * cp };
      };
      const unit = size / 520;

      // The sea: very faint dots that give the ball its roundness
      ctx.fillStyle = K.sea;
      for (let i = 0; i < seaPts.length; i += 2) {
        const q = project(seaPts[i], seaPts[i + 1]);
        if (q.z <= 0) continue;
        ctx.globalAlpha = 0.18 + 0.22 * q.z;
        const d = (0.7 + 0.5 * q.z) * unit;
        ctx.beginPath();
        ctx.arc(cx + q.x * r, cy - q.y * r, d, 0, Math.PI * 2);
        ctx.fill();
      }

      // Land: round dots, bigger and darker toward the middle (depth)
      for (let i = 0; i < pts.length; i += 2) {
        const q = project(pts[i], pts[i + 1]);
        if (q.z <= 0) continue;
        ctx.globalAlpha = 0.35 + 0.65 * q.z;
        ctx.fillStyle = q.z > 0.55 ? K.land[0] : K.land[1];
        const d = (0.85 + 0.75 * q.z) * unit;
        ctx.beginPath();
        ctx.arc(cx + q.x * r, cy - q.y * r, d, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Visitors: green points with a pulse
      const list = placesRef.current;
      const top = Math.max(1, ...list.map((p) => p.n));
      const out: typeof screen.current = [];
      const pulse = (time % 2400) / 2400;
      for (const p of list) {
        const q = project(p.lat * RAD, p.lng * RAD);
        if (q.z <= 0.05) continue;
        const sx = cx + q.x * r;
        const sy = cy - q.y * r;
        const rr = (2.4 + 3 * Math.sqrt(p.n / top)) * Math.max(0.8, unit);
        if (!still) {
          for (const k of [0, 0.5]) {
            const ph = (pulse + k) % 1;
            ctx.globalAlpha = (1 - ph) * 0.3 * q.z;
            ctx.fillStyle = K.spot;
            ctx.beginPath();
            ctx.arc(sx, sy, rr * (1 + ph * 2.6), 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.globalAlpha = 0.55 + 0.45 * q.z;
        ctx.fillStyle = K.spot;
        ctx.beginPath();
        ctx.arc(sx, sy, rr, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = K.ring;
        ctx.lineWidth = 1.5;
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
          v.spin = 0;
          v.last = { x: e.clientX, t: performance.now() };
        }}
        onPointerMove={(e) => {
          const v = view.current;
          if (v.drag) {
            const dx = e.clientX - v.drag.x;
            const dy = e.clientY - v.drag.y;
            if (Math.abs(dx) + Math.abs(dy) > 3) v.drag.moved = true;
            v.lng = v.drag.lng + dx * 0.35;
            const now = performance.now();
            const dt = Math.max(1, now - v.last.t);
            // Degrees per frame (~16 ms) at release, for the glide afterwards
            v.spin = Math.max(-6, Math.min(6, ((e.clientX - v.last.x) * 0.35 * 16) / dt));
            v.last = { x: e.clientX, t: now };
            v.lat = Math.max(-60, Math.min(60, v.drag.lat + dy * 0.35));
            setTip(null);
          } else if (e.pointerType === "mouse") showTip(e.clientX, e.clientY);
        }}
        onPointerUp={(e) => {
          const v = view.current;
          const d = v.drag;
          v.drag = null;
          // A tap (no drag) on a point shows its city.
          if (d && !d.moved) {
            v.spin = 0;
            showTip(e.clientX, e.clientY);
          } else if (performance.now() - v.last.t > 80) v.spin = 0;
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
