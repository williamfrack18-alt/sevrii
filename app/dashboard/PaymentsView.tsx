"use client";

import { useEffect, useMemo, useState } from "react";
import { useLang } from "@/components/LangProvider";
import { PAYMENTS_TEXT } from "@/lib/paymentsI18n";
import { ACCENT, BRAND_BTN, TINT } from "@/lib/panel";
import {
  createPayLinkAction,
  loadPaymentsAction,
  setPayLinkActiveAction,
  startOnboardingAction,
  type ClientPayLink,
  type PaymentsState,
} from "@/app/paymentsActions";
import type { ClientBusiness, ClientService } from "./types";

// Same minimum as the server (MIN_AMOUNT_CENTS in lib/payments.ts).
const MIN_CENTS = 1500;

// Same rule as the server (lib/payments.ts): 5% in total, Stripe's fee included.
function netCents(amount: number): number {
  const stripe = Math.round(amount * 0.029) + 30;
  const sevrii = Math.max(0, Math.round(amount * 0.05) - stripe);
  return amount - stripe - sevrii;
}

function usd(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

// "$120", "Desde $80", "120.50" → "120" / "120.50"
function priceFromService(p: string | null): string {
  const m = (p || "").replace(/,/g, "").match(/\d+(\.\d{1,2})?/);
  return m ? m[0] : "";
}

function toCents(v: string): number | null {
  const s = v.replace(/[$,\s]/g, "");
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

// The sample payment link uses this project's own service and price (or its
// agent's first access option); with neither, a generic one without a brand.
function sampleLink(business: ClientBusiness, services: ClientService[], es: boolean): { label: string; title: string; amount: string } {
  const fmt = (n: number) => `$${n.toFixed(2)}`;
  const svc = services.find((x) => priceFromService(x.price));
  if (svc) return { label: business.name, title: svc.name, amount: fmt(Number(priceFromService(svc.price))) };
  const offer = business.serviceAgent?.offers?.find((o) => o.priceCents > 0);
  if (offer) return { label: business.name, title: offer.title, amount: fmt(offer.priceCents / 100) };
  return { label: es ? "Tu negocio" : "Your business", title: es ? "Tu servicio" : "Your service", amount: "$100.00" };
}

export default function PaymentsView({ business, services }: { business: ClientBusiness; services: ClientService[] }) {
  const lang = useLang();
  const t = PAYMENTS_TEXT[lang];
  const example = sampleLink(business, services, lang === "es");
  const [state, setState] = useState<PaymentsState | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadPaymentsAction()
      .then((s) => alive && setState(s))
      .catch(() => alive && setState({ ready: false, status: "none", links: [], payments: [], error: "stripe" }));
    // Coming back from Stripe: clean the URL so a refresh doesn't look like a new return.
    if (window.location.search.includes("connect=")) window.history.replaceState(null, "", "/dashboard?view=payments");
    return () => {
      alive = false;
    };
  }, [business.id]);

  async function goStripe() {
    setBusy(true);
    setErr(null);
    try {
      const res = await startOnboardingAction();
      if (res.url) {
        window.location.href = res.url;
        return;
      }
      setErr(res.error === "not_ready" ? t.errNotReady : res.error === "connect" ? t.errConnect : res.error === "rate" ? t.errRate : t.errFailed);
    } catch {
      setErr(t.errFailed);
    }
    setBusy(false);
  }

  if (!state) {
    return <div className="px-4 md:px-10 py-12 text-muted text-[14px]">{t.loading}</div>;
  }

  const ready = state.status === "ready";

  return (
    <div className="px-4 md:px-10 py-6 md:py-12 max-w-[1180px]">
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <span className="text-[15px] font-medium" style={{ color: ACCENT }}>
          {t.eyebrow}
        </span>
        {ready && (
          <span className="text-[12px] font-medium px-3 py-1 rounded-full" style={{ background: TINT, color: ACCENT }}>
            ✓ {t.active}
          </span>
        )}
      </div>

      {state.error && <p className="mb-6 text-[14px] text-red-600">{t.errLoad}</p>}

      {ready ? (
        <ReadyView state={state} setState={setState} services={services} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-10 lg:gap-16 items-center">
          <div className="min-w-0">
            <h1 className="font-serif text-[32px] md:text-[46px] leading-[1.05] mb-4 break-words">{t.title}</h1>
            <p className="text-muted text-[16px] leading-relaxed max-w-[520px]">{t.lead}</p>

            {state.blocked ? (
              <div className="mt-8 card p-5">
                <div className="text-[16px] font-[500] mb-1">{t.blockedTitle}</div>
                <p className="text-[14px] text-muted mb-4">{t.blockedNote}</p>
                <div className="flex flex-wrap gap-2">
                  <a href="https://dashboard.stripe.com" target="_blank" rel="noreferrer" className="btn-ghost">
                    {t.openStripe} ↗
                  </a>
                  <button type="button" onClick={goStripe} disabled={busy} className="btn-ghost">
                    {busy ? t.opening : t.reviewBtn}
                  </button>
                </div>
              </div>
            ) : state.status === "review" ? (
              <div className="mt-8 card p-5">
                <div className="text-[16px] font-[500] mb-1">{t.reviewTitle}</div>
                <p className="text-[14px] text-muted mb-4">{t.reviewNote}</p>
                <button type="button" onClick={goStripe} disabled={busy} className="btn-ghost">
                  {busy ? t.opening : t.reviewBtn}
                </button>
              </div>
            ) : (
              <>
                <ol className="mt-8 border-t border-border">
                  {t.steps.map(([title, text], i) => (
                    <li key={title} className="py-4 border-b border-border flex gap-4">
                      <span className="text-[14px] font-medium w-5 shrink-0" style={{ color: ACCENT }}>
                        {i + 1}
                      </span>
                      <div>
                        <div className="text-[16px] font-[450] mb-1">{title}</div>
                        <div className="text-[14px] text-muted">{text}</div>
                      </div>
                    </li>
                  ))}
                </ol>
                {state.status === "pending" && <p className="mt-6 text-[14px] text-muted">{t.pendingNote}</p>}
                <button
                  type="button"
                  onClick={goStripe}
                  disabled={busy}
                  className="mt-6 inline-flex items-center justify-center rounded-full px-6 py-3 text-[15px] font-semibold disabled:opacity-60"
                  style={BRAND_BTN}
                >
                  {busy ? t.opening : state.status === "pending" ? t.continue : t.start}
                </button>
              </>
            )}
            {err && <p className="mt-4 text-[14px] text-red-600">{err}</p>}

            <div className="mt-8 rounded-[24px] p-4" style={{ background: "rgba(10,10,10,0.034)", border: "1px solid rgba(10,10,10,0.068)" }}>
              <div className="text-[14px] font-medium mb-1">{t.feeTitle}</div>
              <div className="text-[13.5px] text-muted leading-relaxed">{t.feeText}</div>
            </div>
          </div>

          <div className="soon-stage">
            <div className="soon-mock">
              <div className="soon-toast">
                <b>✓</b>
                {lang === "es" ? `Pago recibido · ${example.amount}` : `Payment received · ${example.amount}`}
              </div>
              <div className="soon-card">
                <div className="lbl">{example.label}</div>
                <div className="svc">{example.title}</div>
                <div className="amt">{example.amount}</div>
                <div className="pay">{lang === "es" ? `Pagar ${example.amount}` : `Pay ${example.amount}`}</div>
                <div className="url">sevrii.com/pay</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ReadyView({
  state,
  setState,
  services,
}: {
  state: PaymentsState;
  setState: (s: PaymentsState) => void;
  services: ClientService[];
}) {
  const lang = useLang();
  const t = PAYMENTS_TEXT[lang];
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const cents = toCents(amount);
  const total = useMemo(() => state.payments.reduce((s, p) => s + p.amountCents, 0), [state.payments]);
  const quick = services.filter((s) => priceFromService(s.price)).slice(0, 6);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await createPayLinkAction({ title, amount, description: desc });
      if (res.ok) {
        setState({ ...state, links: res.links });
        setTitle("");
        setAmount("");
        setDesc("");
      } else {
        setErr(res.error === "title" ? t.errTitle : res.error === "amount" ? t.errAmount : res.error === "limit" ? t.errLimit : t.errGeneric);
      }
    } catch {
      setErr(t.errGeneric);
    }
    setBusy(false);
  }

  async function toggle(l: ClientPayLink) {
    try {
      const links = await setPayLinkActiveAction(l.id, !l.active);
      setState({ ...state, links });
    } catch {}
  }

  async function copy(l: ClientPayLink) {
    try {
      await navigator.clipboard.writeText(l.url);
      setCopied(l.id);
      setTimeout(() => setCopied(null), 1600);
    } catch {}
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
        <h1 className="font-serif text-[32px] md:text-[42px] leading-[1.05]">{t.title}</h1>
        <a href="https://dashboard.stripe.com" target="_blank" rel="noreferrer" className="btn-ghost">
          {t.openStripe} ↗
        </a>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] gap-8">
        {/* New link */}
        <form onSubmit={create} className="card p-5 md:p-6 self-start">
          <div className="text-[17px] font-[500] mb-4">{t.newLink}</div>
          {quick.length > 0 && (
            <div className="mb-4">
              <div className="text-[12.5px] text-muted mb-2">{t.fromServices}</div>
              <div className="flex flex-wrap gap-2">
                {quick.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      setTitle(s.name.slice(0, 80));
                      setAmount(priceFromService(s.price));
                      setDesc((s.description || "").slice(0, 240));
                    }}
                    className="text-[12.5px] px-3 py-1.5 max-md:min-h-[40px] max-md:max-w-full max-md:truncate rounded-full border border-border hover:border-borderStrong"
                  >
                    {s.name} · ${priceFromService(s.price)}
                  </button>
                ))}
              </div>
            </div>
          )}
          <label className="block text-[13px] text-muted mb-1.5">{t.concept}</label>
          <input className="input w-full mb-4" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder={t.conceptPh} />
          <label className="block text-[13px] text-muted mb-1.5">{t.amount}</label>
          <div className="relative mb-1.5">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">$</span>
            <input
              className="input w-full pl-7"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={t.amountPh}
            />
          </div>
          <div className="text-[12.5px] mb-4" style={{ color: ACCENT, minHeight: 18 }}>
            {cents ? (cents >= MIN_CENTS ? t.youGet(usd(netCents(cents))) : t.minAmount) : ""}
          </div>
          <label className="block text-[13px] text-muted mb-1.5">{t.desc}</label>
          <textarea className="input w-full mb-4 min-h-[72px]" value={desc} maxLength={240} onChange={(e) => setDesc(e.target.value)} placeholder={t.descPh} />
          {err && <p className="mb-3 text-[13.5px] text-red-600">{err}</p>}
          <button type="submit" disabled={busy} className="w-full rounded-full px-5 py-3 text-[15px] font-semibold disabled:opacity-60" style={BRAND_BTN}>
            {busy ? t.creating : t.create}
          </button>
          <p className="mt-3 text-[12px] text-mutedLight leading-relaxed">{t.feeTitle}. {t.onPage}</p>
        </form>

        <div className="min-w-0">
          {/* Links */}
          <div className="text-[17px] font-[500] mb-3">{t.links}</div>
          {state.links.length === 0 ? (
            <p className="text-[14px] text-muted mb-10">{t.noLinks}</p>
          ) : (
            <ul className="border-t border-border mb-10">
              {state.links.map((l) => (
                <li key={l.id} className="py-4 border-b border-border">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="min-w-0 max-w-full">
                      <div className={`text-[15.5px] font-[450] break-words ${l.active ? "" : "text-muted line-through"}`}>{l.title}</div>
                      <div className="text-[12.5px] text-mutedLight truncate">{l.url.replace(/^https?:\/\//, "")}</div>
                    </div>
                    <div className="text-[16px] font-medium">{usd(l.amountCents)}</div>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-3">
                    {l.active ? (
                      <>
                        <button type="button" onClick={() => copy(l)} className="dash-chip-btn">
                          {copied === l.id ? `✓ ${t.copied}` : t.copy}
                        </button>
                        <a
                          className="dash-chip-btn"
                          target="_blank"
                          rel="noreferrer"
                          href={`https://wa.me/?text=${encodeURIComponent(t.waMsg(l.title, usd(l.amountCents), l.url))}`}
                        >
                          {t.whatsapp}
                        </a>
                        <a className="dash-chip-btn" href={l.url} target="_blank" rel="noreferrer">
                          {t.open} ↗
                        </a>
                        <button type="button" onClick={() => toggle(l)} className="dash-chip-btn muted">
                          {t.turnOff}
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="text-[12.5px] text-mutedLight self-center">{t.off}</span>
                        <button type="button" onClick={() => toggle(l)} className="dash-chip-btn">
                          {t.turnOn}
                        </button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {/* Payments */}
          <div className="flex items-baseline justify-between gap-3 mb-3">
            <div className="text-[17px] font-[500]">{t.received}</div>
            {state.payments.length > 0 && (
              <div className="text-[13px] text-muted">
                {t.total}: <span className="text-ink font-medium">{usd(total)}</span>
              </div>
            )}
          </div>
          {state.payments.length === 0 ? (
            <p className="text-[14px] text-muted">{t.noPayments}</p>
          ) : (
            <ul className="border-t border-border">
              {state.payments.map((p) => (
                <li key={p.id} className="py-3 border-b border-border flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[14.5px] truncate">{p.title || "—"}</div>
                    <div className="text-[12.5px] text-mutedLight truncate">
                      {new Date(p.createdAt).toLocaleDateString(lang === "es" ? "es-US" : "en-US", { month: "short", day: "numeric" })}
                      {p.name || p.email ? ` · ${p.name || p.email}` : ""}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[15px] font-medium">{usd(p.amountCents)}</div>
                    <div className="text-[12px] text-mutedLight">
                      {t.net} {usd(p.amountCents - p.feeCents)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
