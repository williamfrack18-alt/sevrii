"use client";

import { useTransition } from "react";
import { useLang } from "@/components/LangProvider";
import { PLAN_TEXT, PROJECTS_TEXT } from "@/lib/planI18n";
import { PLANS_TEXT } from "@/lib/plansI18n";
import { switchProjectAction } from "@/app/actions";
import type { ClientProject, DashboardView } from "./types";
import { ACCENT, BRAND_BTN, RING } from "@/lib/brand";

const GREEN = ACCENT;
const MAX_PROJECTS = 10;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

// Projects = where everything starts. One card per service the owner sells;
// each project has its own Brain plan, Store page and Marketing campaigns.
export default function ProjectsView({
  projects,
  activeId,
  onNavigate,
  projectLimit = MAX_PROJECTS,
}: {
  projectLimit?: number;
  projects: ClientProject[];
  activeId: string;
  onNavigate: (view: DashboardView) => void;
}) {
  const lang = useLang();
  const t = PROJECTS_TEXT[lang];
  const [pending, start] = useTransition();
  const atLimit = projects.length >= Math.min(MAX_PROJECTS, projectLimit);
  const lk = PLANS_TEXT[lang].lock;

  return (
    <div className="min-h-screen" style={{ background: "#000" }}>
      <div className="h-14 px-4 md:px-6 flex items-center">
        <span className="text-[17px] font-semibold text-white">
          Sevrii <span className="text-[#8e8e8e] font-normal">· {PLAN_TEXT[lang].nav.projects}</span>
        </span>
      </div>

      <div className="max-w-[1100px] mx-auto px-4 md:px-8 pt-8 md:pt-14 pb-16">
        <h1 className="text-[28px] md:text-[34px] font-semibold text-white tracking-tight">{t.title}</h1>
        <p className="text-[15px] text-[#8e8e8e] mt-2 max-w-[560px] leading-relaxed">{t.sub}</p>

        <div className="flex items-center gap-2 mt-5 text-[12.5px] text-[#a1a1aa] flex-wrap">
          {t.flow.map((step, i) => (
            <span key={step} className="flex items-center gap-2">
              <span className="px-2.5 py-1 rounded-full" style={{ background: "rgba(255,255,255,0.06)" }}>
                {i + 1}. {step}
              </span>
              {i < t.flow.length - 1 && <span className="text-[#52525b]">→</span>}
            </span>
          ))}
        </div>

        <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-9 ${pending ? "opacity-60 pointer-events-none" : ""}`}>
          {projects.map((p) => {
            const active = p.id === activeId;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => (active ? onNavigate("plan") : start(() => switchProjectAction(p.id)))}
                className="text-left rounded-2xl p-5 flex flex-col gap-4 transition hover:-translate-y-0.5"
                style={{
                  background: "#111",
                  boxShadow: active ? `0 0 0 1.5px ${RING}` : "0 0 0 1px rgba(255,255,255,0.08)",
                }}
              >
                <div className="flex items-start gap-3">
                  <div
                    className="w-11 h-11 rounded-xl text-white flex items-center justify-center text-[14px] font-semibold shrink-0"
                    style={{ background: `linear-gradient(135deg, ${p.accentColor === "#122118" ? "#234f36" : p.accentColor} 0%, #0f2a1c 100%)` }}
                  >
                    {initials(p.name)}
                  </div>
                  <div className="grow min-w-0">
                    <div className="text-[16px] font-semibold text-white truncate">{p.name}</div>
                    <div className="text-[13px] text-[#8e8e8e] truncate">
                      {p.planService || p.category}
                      {p.city ? ` · ${p.city}` : ""}
                    </div>
                  </div>
                  {active ? (
                    <span className="text-[11.5px] font-semibold px-2.5 py-1 rounded-full shrink-0" style={{ background: "rgba(46,122,85,0.31)", color: GREEN }}>
                      {t.current}
                    </span>
                  ) : (
                    <span className="text-[12px] text-[#a1a1aa] shrink-0">{t.open} →</span>
                  )}
                </div>

                <div className="flex flex-wrap gap-1.5">
                  <Chip on={p.planReady}>{p.planReady ? t.planReady : t.planPending}</Chip>
                  <Chip on={p.published}>{p.published ? t.live : t.draft}</Chip>
                </div>

                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12.5px] text-[#a1a1aa] pt-3" style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
                  <span>
                    <b className="text-white font-semibold">{p.pageViews}</b> {t.views}
                  </span>
                  <span>
                    <b className="text-white font-semibold">{p.contacts}</b> {t.contacts}
                  </span>
                  <span>{t.services(p.services)}</span>
                  <span>{t.campaigns(p.campaigns)}</span>
                </div>
              </button>
            );
          })}

          {atLimit && projectLimit >= MAX_PROJECTS ? (
            <div className="rounded-2xl p-5 flex items-center justify-center text-center text-[13.5px] text-[#8e8e8e]" style={{ border: "1.5px dashed rgba(255,255,255,0.14)" }}>
              {t.limit}
            </div>
          ) : atLimit ? (
            <button
              type="button"
              onClick={() => onNavigate("plans")}
              className="rounded-2xl p-5 min-h-[188px] flex flex-col items-center justify-center gap-2.5 text-center transition hover:bg-white/[0.03]"
              style={{ border: "1.5px dashed rgba(255,255,255,0.18)" }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="5" y="11" width="14" height="9" rx="2" />
                <path d="M8 11V8a4 4 0 0 1 8 0v3" />
              </svg>
              <span className="text-[15px] font-semibold text-white">{lk.projectsLocked(projectLimit)}</span>
              <span className="text-[13px] text-[#8e8e8e]">{lk.projectsLockedSub}</span>
              <span className="text-[12.5px] font-semibold px-3 py-1.5 rounded-full mt-1" style={BRAND_BTN}>
                {lk.seePlans}
              </span>
            </button>
          ) : (
            <a
              href="/start?new=1"
              className="rounded-2xl p-5 min-h-[188px] flex flex-col items-center justify-center gap-3 text-center transition hover:bg-white/[0.03]"
              style={{ border: "1.5px dashed rgba(255,255,255,0.18)" }}
            >
              <span className="w-11 h-11 rounded-full flex items-center justify-center text-[24px] leading-none" style={BRAND_BTN}>
                +
              </span>
              <span className="text-[15.5px] font-semibold text-white">{t.newProject}</span>
              <span className="text-[13px] text-[#8e8e8e]">{t.newProjectSub}</span>
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function Chip({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <span
      className="text-[11.5px] font-medium px-2.5 py-1 rounded-full"
      style={on ? { background: "rgba(46,122,85,0.26)", color: GREEN } : { background: "rgba(255,255,255,.07)", color: "#a1a1aa" }}
    >
      {children}
    </span>
  );
}
