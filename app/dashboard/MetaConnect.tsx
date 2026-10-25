"use client";

import { useEffect, useState } from "react";
import { chooseMetaAssetsAction, disconnectMetaAction, getMetaStatusAction, type MetaStatus } from "@/app/metaActions";
import { ACCENT, BRAND_BTN, TINT } from "@/lib/panel";

const TEXT = {
  es: {
    title: "Publicar automático en Facebook e Instagram",
    soon: "Próximamente",
    soonLine: "Pronto podrás crear tus campañas en Meta con un toque, sin entrar al Administrador de anuncios.",
    sub: "Conecta tu Facebook para que Sevrii publique en tu cuenta publicitaria las campañas que apruebes. Nada se publica ni gasta sin tu OK. Si ya aprobaste una campaña, se publica después de conectar.",
    connect: "Conectar con Facebook",
    choose: "Elige dónde se crean tus anuncios.",
    account: "Cuenta publicitaria",
    page: "Página de Facebook",
    pick: "Elegir…",
    save: "Guardar",
    none: "No encontramos cuentas publicitarias o páginas en tu Facebook. Créalas en Meta y vuelve a conectar.",
    notUsd: "(no usa USD)",
    inactive: "(inactiva)",
    connectedAs: (n: string) => `Conectado como ${n || "Facebook"}`,
    acct: "Cuenta",
    pg: "Página",
    disconnect: "Desconectar",
    confirmDisconnect: "¿Desconectar Facebook? Las campañas que ya creaste siguen en tu cuenta de Meta.",
    yes: "Sí, desconectar",
    cancel: "Cancelar",
    expired: "La conexión con Facebook venció. Desconecta y vuelve a conectar.",
    connected: "Listo, Facebook quedó conectado.",
    error: "No se pudo conectar con Facebook. Inténtalo de nuevo.",
    cancelled: "Cancelaste la conexión con Facebook.",
    failed: "No se pudo guardar. Inténtalo de nuevo.",
  },
  en: {
    title: "Auto-publish on Facebook and Instagram",
    soon: "Coming soon",
    soonLine: "Soon you'll create your Meta campaigns with one tap, without going into Ads Manager.",
    sub: "Connect your Facebook so Sevrii publishes the campaigns you approve in your ad account. Nothing is published or spent without your OK. If you already approved a campaign, it's published after you connect.",
    connect: "Connect with Facebook",
    choose: "Choose where your ads are created.",
    account: "Ad account",
    page: "Facebook page",
    pick: "Choose…",
    save: "Save",
    none: "We didn't find ad accounts or pages on your Facebook. Create them in Meta and connect again.",
    notUsd: "(not USD)",
    inactive: "(inactive)",
    connectedAs: (n: string) => `Connected as ${n || "Facebook"}`,
    acct: "Account",
    pg: "Page",
    disconnect: "Disconnect",
    confirmDisconnect: "Disconnect Facebook? Campaigns you already created stay in your Meta account.",
    yes: "Yes, disconnect",
    cancel: "Cancel",
    expired: "The Facebook connection expired. Disconnect and connect again.",
    connected: "Done, Facebook is connected.",
    error: "Couldn't connect to Facebook. Try again.",
    cancelled: "You cancelled the Facebook connection.",
    failed: "Couldn't save. Try again.",
  },
};

const card = { background: "#FFFFFF", boxShadow: "0 1px 2px rgba(10,10,10,.04), 0 10px 30px -14px rgba(10,10,10,.14), 0 0 0 1px rgba(10,10,10,.05)" };
const select = "h-10 rounded-xl px-3 text-[13.5px] text-pfg outline-none w-full";
const selectStyle = { background: "#FFFFFF", boxShadow: "0 0 0 1px rgba(10,10,10,0.085)" };
const ghost = { background: "rgba(10,10,10,0.068)", color: "#0A0A0A" };

export default function MetaConnect({ lang }: { lang: "es" | "en" }) {
  const t = TEXT[lang];
  const [s, setS] = useState<MetaStatus | null>(null);
  const [acct, setAcct] = useState("");
  const [page, setPage] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState(false);

  async function load() {
    const r = await getMetaStatusAction().catch(() => null);
    setS(r ?? { ready: false, connected: false, fbUserName: "", adAccount: null, page: null });
    if (r?.adAccounts?.length === 1) setAcct(r.adAccounts[0].id);
    if (r?.pages?.length === 1) setPage(r.pages[0].id);
  }

  useEffect(() => {
    load();
    // Back from Facebook: /dashboard?view=marketing&meta=connected|error|cancel
    try {
      const m = new URLSearchParams(window.location.search).get("meta");
      if (m === "connected") setNote(t.connected);
      else if (m === "error") setNote(t.error);
      else if (m === "cancel") setNote(t.cancelled);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    if (!acct || !page) return;
    setBusy(true);
    setNote("");
    try {
      const r = await chooseMetaAssetsAction(acct, page);
      if ("error" in r) setNote(r.error);
      else await load();
    } catch {
      setNote(t.failed);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setNote("");
    try {
      await disconnectMetaAction();
      setConfirm(false);
      await load();
    } catch {
      setNote(t.failed);
    } finally {
      setBusy(false);
    }
  }

  if (!s) return null;

  if (!s.ready) {
    return (
      <div className="rounded-[24px] p-4 md:p-5" style={{ ...card, opacity: 0.75 }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[15px] font-semibold text-pfg">{t.title}</h3>
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "rgba(10,10,10,0.068)", color: "#52525B" }}>
            {t.soon}
          </span>
        </div>
        <p className="text-[13px] text-psub mt-1">{t.soonLine}</p>
      </div>
    );
  }

  const chooseAssets = s.connected && !s.expired && (!s.adAccount || !s.page);
  const accounts = s.adAccounts ?? [];
  const pages = s.pages ?? [];

  return (
    <div className="rounded-[24px] p-4 md:p-5 flex flex-col gap-3" style={card}>
      <div>
        <h3 className="text-[15px] font-semibold text-pfg">{t.title}</h3>
        {!s.connected && <p className="text-[13px] text-psub mt-1">{t.sub}</p>}
      </div>

      {!s.connected && (
        <div>
          <a href="/api/meta/connect" className="inline-flex items-center h-10 px-5 rounded-full text-[13.5px] font-semibold" style={BRAND_BTN}>
            {t.connect}
          </a>
        </div>
      )}

      {s.connected && (
        <p className="text-[13px] text-pfg2 break-words">
          <span style={{ color: ACCENT }}>{t.connectedAs(s.fbUserName)}</span>
          {s.adAccount && <span className="text-psub">{` · ${t.acct}: ${s.adAccount.name}`}</span>}
          {s.page && <span className="text-psub">{` · ${t.pg}: ${s.page.name}`}</span>}
        </p>
      )}

      {s.connected && s.expired && <p className="text-[12.5px]" style={{ color: "#92400E" }}>{t.expired}</p>}

      {chooseAssets && (
        accounts.length === 0 || pages.length === 0 ? (
          <p className="text-[12.5px] text-psub leading-relaxed">{t.none}</p>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-[12.5px] text-psub">{t.choose}</p>
            <div className="grid md:grid-cols-2 gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[12px] text-pmuted">{t.account}</span>
                <select value={acct} onChange={(e) => setAcct(e.target.value)} className={select} style={selectStyle}>
                  <option value="">{t.pick}</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id} disabled={!a.active || (a.currency !== "" && a.currency !== "USD")}>
                      {a.name}
                      {!a.active ? ` ${t.inactive}` : a.currency && a.currency !== "USD" ? ` ${t.notUsd}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[12px] text-pmuted">{t.page}</span>
                <select value={page} onChange={(e) => setPage(e.target.value)} className={select} style={selectStyle}>
                  <option value="">{t.pick}</option>
                  {pages.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div>
              <button type="button" disabled={busy || !acct || !page} onClick={save} className="h-9 px-4 rounded-full text-[13px] font-semibold disabled:opacity-60" style={BRAND_BTN}>
                {t.save}
              </button>
            </div>
          </div>
        )
      )}

      {s.connected && (
        <div className="flex flex-wrap items-center gap-2">
          {!confirm ? (
            <button type="button" disabled={busy} onClick={() => setConfirm(true)} className="h-9 px-4 rounded-full text-[13px] disabled:opacity-60" style={ghost}>
              {t.disconnect}
            </button>
          ) : (
            <>
              <span className="text-[12.5px] text-psub w-full">{t.confirmDisconnect}</span>
              <button type="button" disabled={busy} onClick={disconnect} className="h-9 px-4 rounded-full text-[13px] font-semibold disabled:opacity-60" style={{ background: TINT, color: ACCENT }}>
                {t.yes}
              </button>
              <button type="button" disabled={busy} onClick={() => setConfirm(false)} className="h-9 px-4 rounded-full text-[13px] disabled:opacity-60" style={ghost}>
                {t.cancel}
              </button>
            </>
          )}
        </div>
      )}

      {note && <p className="text-[12.5px]" style={{ color: ACCENT }}>{note}</p>}
    </div>
  );
}
