"use client";

import { useState, useTransition } from "react";
import { useT } from "@/components/LangProvider";
import { startProjectAction } from "@/app/actions";

export default function PathPicker({ newProject = false, initial = null }: { newProject?: boolean; initial?: "agent" | null }) {
  const [selected, setSelected] = useState<"existing" | "new" | "agent" | null>(initial);
  const [pending, start] = useTransition();
  const t = useT();

  function cardStyle(active: boolean) {
    return `text-left rounded-2xl p-7 flex flex-col gap-4 border-2 transition ${
      active ? "border-ink bg-mint" : "border-border bg-white hover:border-borderStrong"
    }`;
  }

  return (
    <div className="flex flex-col items-center gap-7">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 w-full max-w-[1040px]">
        <button type="button" onClick={() => setSelected("existing")} className={cardStyle(selected === "existing")}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#122118" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="7" width="18" height="13" rx="2" />
            <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <path d="M3 12h18" />
          </svg>
          <div className="flex flex-col gap-1.5">
            <h3 className="text-[18px] font-semibold">{newProject ? t.start.newProjectExistingTitle : t.start.existingTitle}</h3>
            <p className="text-[14px] text-muted leading-relaxed">{newProject ? t.start.newProjectExistingText : t.start.existingText}</p>
          </div>
        </button>
        <button type="button" onClick={() => setSelected("new")} className={cardStyle(selected === "new")}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#122118" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18h6M10 21h4" />
            <path d="M12 3a6 6 0 0 0-4 10.4c.6.55 1 1.36 1 2.2v.4h6v-.4c0-.84.4-1.65 1-2.2A6 6 0 0 0 12 3z" />
          </svg>
          <div className="flex flex-col gap-1.5">
            <h3 className="text-[18px] font-semibold">{newProject ? t.start.newProjectNewTitle : t.start.newTitle}</h3>
            <p className="text-[14px] text-muted leading-relaxed">{newProject ? t.start.newProjectNewText : t.start.newText}</p>
          </div>
        </button>
        <button type="button" onClick={() => setSelected("agent")} className={cardStyle(selected === "agent")}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#122118" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="8" width="16" height="12" rx="3" />
            <path d="M12 8V4M9 4h6" />
            <circle cx="9" cy="14" r="1.2" />
            <circle cx="15" cy="14" r="1.2" />
            <path d="M2 13v3M22 13v3" />
          </svg>
          <div className="flex flex-col gap-1.5">
            <h3 className="text-[18px] font-semibold">{t.start.agentTitle}</h3>
            <p className="text-[14px] text-muted leading-relaxed">{t.start.agentText}</p>
          </div>
        </button>
      </div>

      <p className="text-[13px] text-mutedLight italic">{t.start.note}</p>

      <button
        type="button"
        disabled={!selected || pending}
        onClick={() => selected && start(() => startProjectAction(selected, newProject))}
        className={`w-[220px] h-[48px] rounded-[10px] text-[15px] font-semibold ${
          selected && !pending ? "btn-primary" : "bg-borderStrong text-mutedLight cursor-not-allowed"
        }`}
      >
        {pending ? "…" : t.common.continue}
      </button>
    </div>
  );
}
