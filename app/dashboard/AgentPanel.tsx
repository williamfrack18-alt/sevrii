"use client";

import { useEffect, useState } from "react";
import {
  approveAgentItemAction,
  dismissAgentItemAction,
  getAgentStateAction,
  markPostUsedAction,
  runAgentNowAction,
  setAgentBudgetAction,
  startAgentAction,
} from "@/app/agentActions";
import type { AgentItem, AgentNumbers, AgentPost, AgentResult, AgentState } from "@/lib/agentTypes";
import { MK_TEXT } from "@/lib/marketingI18n";
import { ACCENT, BRAND_BTN } from "@/lib/brand";
import MetaConnect from "./MetaConnect";
import type { ClientBusiness } from "./types";

type Lang = "es" | "en";
type T = (typeof MK_TEXT)["es"]["agent"];

const MIN_BUDGET = 30;
const CARD = { background: "#0f0f0f", boxShadow: "0 0 0 1px rgba(255,255,255,0.08)" } as const;
const TILE = { background: "#141414", boxShadow: "0 0 0 1px rgba(255,255,255,0.06)" } as const;
const GHOST = { background: "rgba(255,255,255,0.08)" } as const;

const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const locale = (lang: Lang) => (lang === "es" ? "es-US" : "en-US");

function ago(iso: string | null, now: number, t: T, lang: Lang): string {
  if (!iso) return "";
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  const m = Math.floor(Math.max(0, now - at) / 60000);
  if (m < 1) return t.ago.now;
  if (m < 60) return t.ago.min(m);
  const h = Math.floor(m / 60);
  if (h < 24) return t.ago.hour(h);
  const d = Math.floor(h / 24);
  if (d < 7) return t.ago.day(d);
  return new Date(at).toLocaleDateString(locale(lang), { month: "short", day: "numeric" });
}

function postDay(day: string, lang: Lang): string {
  const d = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return day;
  return d.toLocaleDateString(locale(lang), { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
}

// The agent that does the owner's marketing. The owner only approves launches
// and budget increases; everything it does is shown here.
export default function AgentPanel({ business, lang, onChanged }: { business: ClientBusiness; lang: Lang; onChanged?: () => void }) {
  const t = MK_TEXT[lang].agent;
  // undefined = still loading; null = nothing to show.
  const [state, setState] = useState<AgentState | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    getAgentStateAction()
      .then((s) => {
        if (alive) setState(s ?? null);
      })
      .catch(() => {
        if (alive) setState(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (state === null || (state && !state.allowed)) return null;

  return (
    <section className="px-4 md:px-8 pt-6 pb-8" style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
      <div className="max-w-[1100px] mx-auto">
        {state === undefined ? (
          <div className="rounded-3xl p-6 md:p-7 flex items-center gap-3" style={CARD}>
            <span className="h-2 w-2 rounded-full animate-pulse" style={{ background: ACCENT }} />
            <span className="text-[14px] text-[#a1a1a1]">{t.loading}</span>
          </div>
        ) : !state.started ? (
          <StartCard
            t={t}
            onStarted={(s) => {
              setState(s);
              onChanged?.();
            }}
          />
        ) : (
          <Dashboard state={state} setState={setState} business={business} lang={lang} t={t} onChanged={onChanged} />
        )}
      </div>
    </section>
  );
}

function StartCard({ t, onStarted }: { t: T; onStarted: (s: AgentState) => void }) {
  const [budget, setBudget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    const n = Math.round(Number(budget));
    if (!Number.isFinite(n) || n < MIN_BUDGET) {
      setError(t.minBudget(MIN_BUDGET));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await startAgentAction(n);
      if (res.ok) onStarted(res.state);
      else setError(res.error || t.failed);
    } catch {
      setError(t.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-3xl p-6 md:p-8 flex flex-col gap-5" style={CARD}>
      <div className="flex flex-col gap-2">
        <h2 className="text-[22px] md:text-[24px] font-semibold text-white tracking-tight">{t.title}</h2>
        <p className="text-[15px] leading-relaxed text-[#a1a1a1] max-w-[640px]">{t.intro}</p>
      </div>

      {busy ? (
        <div className="flex flex-col gap-3 max-w-[520px]" aria-live="polite">
          <div className="flex items-center gap-2.5">
            <span className="h-2 w-2 rounded-full animate-pulse" style={{ background: ACCENT }} />
            <span className="text-[14.5px] text-white">{t.starting}</span>
          </div>
          <div className="h-1 w-full rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
            <div className="h-full w-1/3 rounded-full animate-pulse" style={{ background: ACCENT }} />
          </div>
          <span className="text-[12.5px] text-[#8e8e8e]">{t.startingSub}</span>
        </div>
      ) : (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            start();
          }}
        >
          <label htmlFor="agent-budget" className="text-[14px] font-medium text-white">
            {t.budgetQ}
          </label>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="h-11 rounded-xl flex items-center px-3.5 gap-1 sm:w-[200px]" style={TILE}>
              <span className="text-[15px] text-[#8e8e8e]">$</span>
              <input
                id="agent-budget"
                type="number"
                inputMode="numeric"
                min={MIN_BUDGET}
                step={1}
                placeholder="150"
                value={budget}
                onChange={(e) => {
                  setBudget(e.target.value);
                  setError(null);
                }}
                className="flex-1 min-w-0 bg-transparent outline-none text-[15px] text-white tabular-nums placeholder:text-[#5c5c5c]"
              />
              <span className="text-[13.5px] text-[#8e8e8e]">{t.perMonth}</span>
            </div>
            <button type="submit" className="h-11 px-6 rounded-full text-[14.5px] font-semibold" style={BRAND_BTN}>
              {t.start}
            </button>
          </div>
          <span className="text-[12.5px] text-[#8e8e8e]">{t.budgetHint}</span>
          {error && <span className="text-[13px] text-[#ff8a8a]">{error}</span>}
        </form>
      )}
    </div>
  );
}

function Dashboard({
  state,
  setState,
  business,
  lang,
  t,
  onChanged,
}: {
  state: AgentState;
  setState: (s: AgentState) => void;
  business: ClientBusiness;
  lang: Lang;
  t: T;
  onChanged?: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ key: string; msg: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const [budget, setBudget] = useState("");

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Runs one action; the returned state replaces ours.
  const act = async (key: string, fn: () => Promise<AgentResult>, changed = false): Promise<boolean> => {
    if (busy) return false;
    setBusy(key);
    setError(null);
    try {
      const res = await fn();
      if (!res.ok) {
        setError({ key, msg: res.error || t.failed });
        return false;
      }
      setState(res.state);
      setNow(Date.now());
      if (changed) onChanged?.();
      return true;
    } catch {
      setError({ key, msg: t.failed });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const saveBudget = async () => {
    const n = Math.round(Number(budget));
    if (!Number.isFinite(n) || n < MIN_BUDGET) {
      setError({ key: "budget", msg: t.minBudget(MIN_BUDGET) });
      return;
    }
    if (await act("budget", () => setAgentBudgetAction(n))) setEditing(false);
  };

  const photos = [business.site.coverUrl, ...business.site.gallery].filter(Boolean);
  const posts = [...state.posts].sort((a, b) => a.day.localeCompare(b.day));
  const activity = state.activity.slice(0, 10);
  const launchWithoutMeta = !state.metaConnected && state.pending.some((i) => i.kind === "launch");
  const headerError = error && (error.key === "budget" || error.key === "run") ? error.msg : null;

  return (
    <div className="rounded-3xl p-5 md:p-7 flex flex-col gap-7" style={CARD}>
      {/* Header */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="flex flex-col gap-1 min-w-0">
            <h2 className="text-[20px] md:text-[22px] font-semibold text-white tracking-tight">{t.title}</h2>
            <span className="flex items-center gap-2 text-[13px] text-[#a1a1a1]">
              <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: ACCENT }} />
              <span>
                {t.working} · {state.lastRunAt ? t.lastRun(ago(state.lastRunAt, now, t, lang)) : t.neverRun}
              </span>
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {editing ? (
              <form
                className="flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  saveBudget();
                }}
              >
                <div className="h-9 rounded-full flex items-center px-3 gap-1 w-[130px]" style={TILE}>
                  <span className="text-[13.5px] text-[#8e8e8e]">$</span>
                  <input
                    autoFocus
                    type="number"
                    inputMode="numeric"
                    min={MIN_BUDGET}
                    step={1}
                    value={budget}
                    onChange={(e) => setBudget(e.target.value)}
                    aria-label={t.budgetQ}
                    className="flex-1 min-w-0 bg-transparent outline-none text-[13.5px] text-white tabular-nums"
                  />
                  <span className="text-[12px] text-[#8e8e8e]">{t.perMonth}</span>
                </div>
                <button type="submit" disabled={busy === "budget"} className="h-9 px-4 rounded-full text-[13px] font-semibold disabled:opacity-60" style={BRAND_BTN}>
                  {t.save}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false);
                    setError(null);
                  }}
                  className="h-9 px-2 text-[13px] text-[#a1a1a1] hover:text-white"
                >
                  {t.cancel}
                </button>
              </form>
            ) : (
              <span className="text-[13.5px] text-[#d4d4d4]">
                {state.budgetUsd != null ? t.upTo(usd(state.budgetUsd)) : "—"}
                <span className="text-[#5c5c5c]"> · </span>
                <button
                  type="button"
                  onClick={() => {
                    setBudget(state.budgetUsd != null ? String(state.budgetUsd) : "");
                    setEditing(true);
                  }}
                  className="text-[#a1a1a1] hover:text-white underline underline-offset-4 decoration-[rgba(255,255,255,.25)]"
                >
                  {t.change}
                </button>
              </span>
            )}
            <button
              type="button"
              onClick={() => act("run", runAgentNowAction, true)}
              disabled={busy !== null}
              className="h-9 px-4 rounded-full text-[13px] font-medium text-[#ececec] hover:text-white disabled:opacity-60"
              style={GHOST}
            >
              {busy === "run" ? t.running : t.runNow}
            </button>
          </div>
        </div>
        {headerError && <span className="text-[13px] text-[#ff8a8a]">{headerError}</span>}
      </div>

      {/* Results */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-[14px] font-medium text-white">{t.week}</span>
          <span className="text-[12px] text-[#8e8e8e]">{t.vsPrev}</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label={t.views} cur={state.week.views} prev={state.prevWeek.views} />
          <Stat label={t.chats} cur={state.week.chats} prev={state.prevWeek.chats} />
          <Stat label={t.contacts} cur={state.week.contacts} prev={state.prevWeek.contacts} />
          <Stat label={t.spent} cur={state.week.spendUsd} prev={state.prevWeek.spendUsd} money />
        </div>
      </div>

      {/* Needs approval */}
      <div className="flex flex-col gap-3">
        <SectionTitle title={t.needsYou} count={state.pending.length} />
        {state.pending.length === 0 ? (
          <p className="text-[13.5px] text-[#8e8e8e]">{t.nothingPending}</p>
        ) : (
          <div className="flex flex-col gap-3">
            {state.pending.map((item) => (
              <PendingCard
                key={item.id}
                item={item}
                t={t}
                metaConnected={state.metaConnected}
                busy={busy}
                error={error?.key === item.id ? error.msg : null}
                onApprove={() => act(item.id, () => approveAgentItemAction(item.id), true)}
                onDismiss={() => act(item.id, () => dismissAgentItemAction(item.id))}
              />
            ))}
            {launchWithoutMeta && <MetaConnect lang={lang} />}
          </div>
        )}
      </div>

      {/* Activity */}
      <div className="flex flex-col gap-3">
        <SectionTitle title={t.activity} />
        {activity.length === 0 ? (
          <p className="text-[13.5px] text-[#8e8e8e]">{t.noActivity}</p>
        ) : (
          <ul className="flex flex-col rounded-2xl overflow-hidden" style={TILE}>
            {activity.map((item, i) => (
              <li key={item.id} className="px-4 py-3 flex flex-col gap-1" style={i > 0 ? { borderTop: "1px solid rgba(255,255,255,0.06)" } : undefined}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-baseline gap-2 min-w-0 flex-wrap">
                    <span className="text-[11px] font-medium uppercase tracking-wider shrink-0" style={{ color: item.kind === "pause" ? "#a1a1a1" : ACCENT }}>
                      {t.kinds[item.kind]}
                    </span>
                    <span className="text-[14px] text-white leading-snug">{item.title}</span>
                    {(item.status === "dismissed" || item.status === "error") && (
                      <span className="text-[12px]" style={{ color: item.status === "error" ? "#ff8a8a" : "#8e8e8e" }}>
                        · {t.statuses[item.status]}
                      </span>
                    )}
                  </div>
                  <span className="text-[12px] text-[#8e8e8e] shrink-0 whitespace-nowrap">{ago(item.resolvedAt || item.createdAt, now, t, lang)}</span>
                </div>
                {item.detail && <p className="text-[13px] text-[#a1a1a1] leading-relaxed whitespace-pre-line">{item.detail}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Posts */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <SectionTitle title={t.posts} />
          {posts.length > 0 && <span className="text-[12.5px] text-[#8e8e8e]">{t.postsSub}</span>}
        </div>
        {posts.length === 0 ? (
          <p className="text-[13.5px] text-[#8e8e8e]">{t.noPosts}</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {posts.map((p) => (
              <PostCard
                key={p.id}
                post={p}
                photo={photos[p.photo] ?? photos[0] ?? ""}
                pageLink={`https://www.sevrii.com/site/${business.slug}`}
                t={t}
                lang={lang}
                busy={busy === p.id}
                error={error?.key === p.id ? error.msg : null}
                onUsed={() => act(p.id, () => markPostUsedAction(p.id))}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SectionTitle({ title, count }: { title: string; count?: number }) {
  return (
    <div className="flex items-center gap-2">
      <h3 className="text-[15.5px] font-semibold text-white">{title}</h3>
      {count != null && count > 0 && (
        <span className="text-[11.5px] font-semibold h-5 min-w-5 px-1.5 rounded-full flex items-center justify-center" style={{ background: "rgba(46,122,85,.28)", color: ACCENT }}>
          {count}
        </span>
      )}
    </div>
  );
}

function Stat({ label, cur, prev, money = false }: { label: string; cur: AgentNumbers["spendUsd"]; prev: AgentNumbers["spendUsd"]; money?: boolean }) {
  const fmt = (n: number) => (money ? usd(n) : n.toLocaleString("en-US"));
  const diff = cur != null && prev != null ? cur - prev : null;
  const up = diff != null && diff > 0;
  // More visits/chats/contacts is good; spend is shown neutral.
  const color = money || !up ? "#8e8e8e" : ACCENT;
  return (
    <div className="rounded-xl px-3.5 py-3 flex flex-col gap-0.5" style={TILE}>
      <span className="text-[11.5px] text-[#8e8e8e]">{label}</span>
      <span className="text-[22px] font-semibold text-white tabular-nums leading-tight">{cur == null ? "—" : fmt(cur)}</span>
      <span className="text-[12px] tabular-nums h-4" style={{ color }}>
        {diff != null && diff !== 0 ? `${up ? "↑" : "↓"} ${fmt(Math.abs(Math.round(diff * 100) / 100))}` : ""}
      </span>
    </div>
  );
}

function PendingCard({
  item,
  t,
  metaConnected,
  busy,
  error,
  onApprove,
  onDismiss,
}: {
  item: AgentItem;
  t: T;
  metaConnected: boolean;
  busy: string | null;
  error: string | null;
  onApprove: () => Promise<boolean>;
  onDismiss: () => Promise<boolean>;
}) {
  const [confirming, setConfirming] = useState(false);
  const needsConfirm = item.kind === "launch" || item.kind === "budget";
  const confirmText = item.kind === "budget" ? t.confirmBudget : metaConnected ? t.confirmLaunch : t.confirmLaunchManual;
  const mine = busy === item.id;
  const disabled = busy !== null;

  return (
    <div className="rounded-2xl p-4 md:p-5 flex flex-col gap-3" style={{ background: "#141414", boxShadow: "0 0 0 1px rgba(125,191,156,0.22)" }}>
      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: ACCENT }}>
          {t.kinds[item.kind]}
        </span>
        <span className="text-[15.5px] font-semibold text-white leading-snug">{item.title}</span>
        {item.detail && <p className="text-[13.5px] text-[#a1a1a1] leading-relaxed whitespace-pre-line">{item.detail}</p>}
        {item.kind === "launch" && !metaConnected && <p className="text-[12.5px] text-[#8e8e8e] leading-relaxed mt-1">{t.noMeta}</p>}
      </div>

      {confirming ? (
        <div className="rounded-xl p-3.5 flex flex-col gap-3" style={{ background: "#0f0f0f", boxShadow: "0 0 0 1px rgba(255,255,255,0.08)" }}>
          <p className="text-[13.5px] text-[#ececec] leading-relaxed">{confirmText}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={disabled}
              onClick={async () => {
                if (!(await onApprove())) setConfirming(false);
              }}
              className="h-9 px-4 rounded-full text-[13.5px] font-semibold disabled:opacity-60"
              style={BRAND_BTN}
            >
              {mine ? "…" : t.yesApprove}
            </button>
            <button type="button" disabled={mine} onClick={() => setConfirming(false)} className="h-9 px-3 text-[13.5px] text-[#a1a1a1] hover:text-white">
              {t.cancel}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => (needsConfirm ? setConfirming(true) : onApprove())}
            className="h-9 px-4 rounded-full text-[13.5px] font-semibold disabled:opacity-60"
            style={BRAND_BTN}
          >
            {mine && !needsConfirm ? "…" : t.approve}
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onDismiss()}
            className="h-9 px-4 rounded-full text-[13.5px] font-medium text-[#d4d4d4] hover:text-white disabled:opacity-60"
            style={GHOST}
          >
            {t.dismiss}
          </button>
        </div>
      )}
      {error && <span className="text-[13px] text-[#ff8a8a]">{error}</span>}
    </div>
  );
}

function PostCard({
  post,
  photo,
  pageLink,
  t,
  lang,
  busy,
  error,
  onUsed,
}: {
  post: AgentPost;
  photo: string;
  pageLink: string;
  t: T;
  lang: Lang;
  busy: boolean;
  error: string | null;
  onUsed: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const used = post.status === "used";
  const small = "h-8 px-3 rounded-full text-[12.5px] font-medium flex items-center text-[#d4d4d4] hover:text-white disabled:opacity-60";

  return (
    <div className="rounded-2xl overflow-hidden flex flex-col" style={{ ...TILE, opacity: used ? 0.5 : 1 }}>
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photo} alt="" loading="lazy" className="w-full aspect-[4/3] object-cover" />
      ) : (
        <div className="w-full aspect-[4/3] flex items-center justify-center text-[12.5px] text-[#8e8e8e]" style={{ background: "linear-gradient(135deg,#1a3a2a,#0b1a12)" }}>
          {t.noPhoto}
        </div>
      )}
      <div className="p-4 flex flex-col gap-3 flex-1">
        <div className="flex items-center justify-between gap-2 text-[12px]">
          <span className="font-medium uppercase tracking-wider" style={{ color: ACCENT }}>
            {t.channels[post.channel]}
          </span>
          <span className="text-[#8e8e8e] first-letter:uppercase">{postDay(post.day, lang)}</span>
        </div>
        <p className="text-[13.5px] text-[#ececec] leading-relaxed whitespace-pre-line flex-1">{post.text}</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={small}
            style={GHOST}
            onClick={() =>
              navigator.clipboard
                // The page link goes with it, so people can write from the post.
                ?.writeText(`${post.text}\n\n${pageLink}`)
                .then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                })
                .catch(() => {})
            }
          >
            {copied ? t.copied : t.copyText}
          </button>
          {photo && (
            <a href={photo} download target="_blank" rel="noopener noreferrer" className={small} style={GHOST}>
              {t.downloadPhoto}
            </a>
          )}
          {used ? (
            <span className="h-8 px-1 flex items-center text-[12.5px]" style={{ color: ACCENT }}>
              {t.used}
            </span>
          ) : (
            <button type="button" disabled={busy} onClick={onUsed} className={small} style={GHOST}>
              {busy ? "…" : t.markUsed}
            </button>
          )}
        </div>
        {error && <span className="text-[12.5px] text-[#ff8a8a]">{error}</span>}
      </div>
    </div>
  );
}
