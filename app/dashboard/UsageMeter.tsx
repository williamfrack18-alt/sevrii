"use client";

import { useEffect, useState } from "react";
import { myUsageAction } from "@/app/accountActions";
import type { UsageSummary } from "@/lib/usage";
import { GREEN } from "@/lib/panel";

// What's left of the plan, always in view: messages today and this month and
// research runs this month. It refreshes after every chat message.
export default function UsageMeter({ lang, onPlans }: { lang: "es" | "en"; onPlans: () => void }) {
  const [u, setU] = useState<UsageSummary | null>(null);
  useEffect(() => {
    let off = false;
    const load = () => myUsageAction().then((x) => !off && setU(x)).catch(() => {});
    load();
    window.addEventListener("sevrii:usage", load);
    const iv = setInterval(load, 60_000);
    return () => {
      off = true;
      window.removeEventListener("sevrii:usage", load);
      clearInterval(iv);
    };
  }, []);
  if (!u) return null;
  const es = lang === "es";
  const left = (x: { used: number; limit: number }) => Math.max(0, x.limit - x.used);
  const rows = [
    { label: es ? "Mensajes hoy" : "Messages today", ...u.day },
    { label: es ? "Mensajes este mes" : "Messages this month", ...u.month },
    { label: es ? "Investigaciones este mes" : "Research runs this month", ...u.research },
  ];
  const low = rows.some((r) => left(r) <= Math.max(1, Math.round(r.limit * 0.1))) || u.budgetPct >= 90;
  const resets = u.day.resetsAt ? new Date(u.day.resetsAt).toLocaleTimeString(es ? "es-US" : "en-US", { hour: "numeric", minute: "2-digit" }) : "";
  return (
    <button type="button" onClick={onPlans} className="w-full rounded-[20px] px-3.5 py-3 text-left bg-pbg hover:bg-psoft transition flex flex-col gap-2" aria-label={es ? "Lo que te queda de tu plan" : "What's left in your plan"}>
      <span className="text-[11.5px] text-pmuted">{es ? "Te queda" : "You have left"}</span>
      {rows.map((r) => {
        const pct = r.limit ? Math.min(100, Math.round((left(r) / r.limit) * 100)) : 0;
        return (
          <span key={r.label} className="flex flex-col gap-1">
            <span className="flex items-baseline justify-between gap-2 text-[12.5px]">
              <span className="text-pfg2 truncate">{r.label}</span>
              <span className="text-pfg font-medium shrink-0 tabular-nums">
                {left(r)} <span className="text-pmuted font-normal">/ {r.limit}</span>
              </span>
            </span>
            <span className="dash-meter-track h-1 rounded-full overflow-hidden" style={{ background: "rgba(10,10,10,0.08)" }}>
              <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: pct <= 10 ? "#D97706" : GREEN }} />
            </span>
          </span>
        );
      })}
      {u.day.used > 0 && resets && <span className="text-[11px] text-pmuted">{es ? `Los de hoy se renuevan a las ${resets}` : `Today's renew at ${resets}`}</span>}
      {low && <span className="text-[11.5px] font-medium" style={{ color: "#B45309" }}>{es ? "Te queda poco · ver planes →" : "Running low · see plans →"}</span>}
    </button>
  );
}
