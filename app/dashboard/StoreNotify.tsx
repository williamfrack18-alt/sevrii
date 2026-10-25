"use client";

import { useEffect, useState } from "react";
import { useLang } from "@/components/LangProvider";
import {
  deletePushSubAction,
  getNotifySettingsAction,
  savePushSubAction,
  setNotifyEmailAction,
  testPushAction,
  testPushDetailedAction,
  type NotifySettings,
} from "@/app/chatActions";
import { ACCENT, BRAND_BTN, TINT } from "@/lib/panel";

const TEXT = {
  es: {
    title: "Avisos cuando te escriben",
    sub: "Para que te enteres aunque estés haciendo otra cosa y entres a responder.",
    email: "Correo",
    emailOn: (e: string) => `Te avisamos a ${e} cuando alguien empieza un chat, deja sus datos o quiere agendar.`,
    emailOff: "Los avisos por correo están apagados.",
    push: "Notificación en tu celular o computador",
    pushOn: "Activadas en este dispositivo. Te llega como la de cualquier app, al instante.",
    pushOff: "Te llega como la notificación de cualquier app, al instante y gratis.",
    enable: "Activar en este dispositivo",
    disable: "Desactivar aquí",
    test: "Enviar prueba",
    testSent: "Listo, revisa tu notificación.",
    testNone: "No se pudo enviar. Revisa que las notificaciones estén permitidas.",
    otherDevices: (n: number) => `Activadas en ${n} dispositivo${n === 1 ? "" : "s"}.`,
    denied: "Bloqueaste las notificaciones para Sevrii en este navegador. Actívalas en la configuración del navegador (el candado junto a la dirección).",
    unsupported: "Este navegador no permite notificaciones. Prueba con Chrome, Edge, Firefox o Safari.",
    ios: "En iPhone: toca Compartir (el cuadro con la flecha) → «Agregar a pantalla de inicio». Abre Sevrii desde ese ícono, entra a Conversaciones → Avisos y actívalas ahí.",
    sms: "Mensaje de texto (SMS)",
    smsSoon: "Próximamente.",
    on: "Activado",
    off: "Apagado",
    failed: "No se pudo activar. Inténtalo de nuevo.",
  },
  en: {
    title: "Alerts when someone writes",
    sub: "So you know even when you're busy, and can jump in to reply.",
    email: "Email",
    emailOn: (e: string) => `We email ${e} when someone starts a chat, leaves their contact or wants to book.`,
    emailOff: "Email alerts are off.",
    push: "Notification on your phone or computer",
    pushOn: "On for this device. It arrives like any app's notification, instantly.",
    pushOff: "It arrives like any app's notification, instantly and free.",
    enable: "Turn on for this device",
    disable: "Turn off here",
    test: "Send a test",
    testSent: "Done, check your notification.",
    testNone: "Couldn't send. Check that notifications are allowed.",
    otherDevices: (n: number) => `On for ${n} device${n === 1 ? "" : "s"}.`,
    denied: "You blocked notifications for Sevrii in this browser. Turn them on in the browser settings (the lock next to the address).",
    unsupported: "This browser doesn't support notifications. Try Chrome, Edge, Firefox or Safari.",
    ios: "On iPhone: tap Share (the square with the arrow) → “Add to Home Screen”. Open Sevrii from that icon, go to Conversations → Alerts and turn them on there.",
    sms: "Text message (SMS)",
    smsSoon: "Coming soon.",
    on: "On",
    off: "Off",
    failed: "Couldn't turn it on. Try again.",
  },
};

function keyBytes(b64: string): Uint8Array {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

// iPads report themselves as a Mac; touch gives them away.
function isIos(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

// Does this subscription use Sevrii's current key? (If the key changed, the
// old subscription can no longer receive anything.)
function sameKey(sub: PushSubscription, key: string): boolean {
  const k = sub.options?.applicationServerKey;
  if (!k) return true;
  const a = new Uint8Array(k);
  const b = keyBytes(key);
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function deviceLabel(): string {
  const ua = navigator.userAgent;
  if (isIos()) return /iPad|Macintosh/.test(ua) ? "iPad" : "iPhone";
  if (/Android/.test(ua)) return "Android";
  if (/Mac/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows";
  return "Browser";
}

type PushState = "loading" | "unsupported" | "ios" | "denied" | "off" | "on";

export default function StoreNotify() {
  const lang = useLang();
  const t = TEXT[lang];
  const [s, setS] = useState<NotifySettings | null>(null);
  const [push, setPush] = useState<PushState>("loading");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [results, setResults] = useState<{ label: string; host: string; ok: boolean; status: number }[]>([]);

  useEffect(() => {
    const settings = getNotifySettingsAction().catch(() => null);
    settings.then(setS);
    (async () => {
      const ios = isIos();
      const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setPush(ios && !standalone ? "ios" : "unsupported");
        return;
      }
      if (Notification.permission === "denied") return setPush("denied");
      try {
        const reg = await navigator.serviceWorker.getRegistration("/");
        let sub = await reg?.pushManager.getSubscription();
        const conf = await settings;
        if (sub && reg && conf?.pushKey && Notification.permission === "granted") {
          // Keep Sevrii's record in step with this browser, so "On" really means on.
          if (!sameKey(sub, conf.pushKey)) {
            await sub.unsubscribe().catch(() => {});
            sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(conf.pushKey) as BufferSource });
          }
          await savePushSubAction(sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } }, deviceLabel()).catch(() => false);
        }
        setPush(sub ? "on" : "off");
      } catch {
        setPush("off");
      }
    })();
  }, []);

  async function enable() {
    if (!s?.pushKey) return;
    setBusy(true);
    setNote("");
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setPush(perm === "denied" ? "denied" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      let existing = await reg.pushManager.getSubscription();
      if (existing && !sameKey(existing, s.pushKey)) {
        await existing.unsubscribe().catch(() => {});
        existing = null;
      }
      const sub = existing ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(s.pushKey) as BufferSource }));
      const ok = await savePushSubAction(sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } }, deviceLabel());
      if (!ok) throw new Error("save");
      setPush("on");
      setS((x) => (x ? { ...x, devices: x.devices + (existing ? 0 : 1) } : x));
      const n = await testPushAction();
      setNote(n > 0 ? t.testSent : t.testNone);
    } catch {
      setNote(t.failed);
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setNote("");
    try {
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await deletePushSubAction(sub.endpoint);
        await sub.unsubscribe();
      }
      setPush("off");
      setS((x) => (x ? { ...x, devices: Math.max(0, x.devices - 1) } : x));
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    try {
      const r = await testPushDetailedAction();
      setResults(r);
      setNote(r.some((x) => x.ok) ? t.testSent : t.testNone);
    } finally {
      setBusy(false);
    }
  }

  async function toggleEmail() {
    if (!s) return;
    const next = !s.email;
    setS({ ...s, email: next });
    if (!(await setNotifyEmailAction(next))) setS({ ...s });
  }

  if (!s) return null;
  const row = "rounded-xl p-4 flex flex-col gap-2";
  const rowStyle = { background: "#FFFFFF", boxShadow: "0 0 0 1px rgba(10,10,10,0.06)" };
  const chip = (on: boolean) => (
    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={on ? { background: TINT, color: ACCENT } : { background: "rgba(10,10,10,0.068)", color: "#52525B" }}>
      {on ? t.on : t.off}
    </span>
  );

  return (
    <div className="rounded-[24px] p-4 md:p-5 mb-5" style={{ background: "#FFFFFF", boxShadow: "0 1px 2px rgba(10,10,10,.04), 0 10px 30px -14px rgba(10,10,10,.14), 0 0 0 1px rgba(10,10,10,.05)" }}>
      <h3 className="text-[15px] font-semibold text-pfg">{t.title}</h3>
      <p className="text-[13px] text-psub mt-1">{t.sub}</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
        {/* Push */}
        <div className={`${row} min-w-0`} style={rowStyle}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[14px] font-semibold text-pfg min-w-0">{t.push}</span>
            {chip(push === "on")}
          </div>
          <p className="text-[12.5px] text-psub leading-relaxed">
            {push === "on" ? t.pushOn : push === "denied" ? t.denied : push === "unsupported" ? t.unsupported : push === "ios" ? t.ios : t.pushOff}
          </p>
          {s.devices > 0 && <p className="text-[12px] text-pmuted">{t.otherDevices(s.devices)}</p>}
          <div className="flex flex-wrap gap-2 mt-auto pt-1">
            {(push === "off" || push === "loading") && (
              <button type="button" disabled={busy || push === "loading" || !s.pushKey} onClick={enable} className="h-10 md:h-9 px-4 rounded-full text-[13px] font-semibold disabled:opacity-60" style={BRAND_BTN}>
                {t.enable}
              </button>
            )}
            {push === "on" && (
              <>
                <button type="button" disabled={busy} onClick={test} className="h-10 md:h-9 px-4 rounded-full text-[13px] font-semibold disabled:opacity-60" style={{ background: TINT, color: ACCENT }}>
                  {t.test}
                </button>
                <button type="button" disabled={busy} onClick={disable} className="h-10 md:h-9 px-4 rounded-full text-[13px] disabled:opacity-60" style={{ background: "rgba(10,10,10,0.068)", color: "#0A0A0A" }}>
                  {t.disable}
                </button>
              </>
            )}
          </div>
          {note && <p className="text-[12.5px]" style={{ color: ACCENT }}>{note}</p>}
          {results.length > 0 && (
            <ul className="text-[12px] text-psub flex flex-col gap-0.5">
              {results.map((r, i) => (
                <li key={i}>
                  {(r.label || r.host || "?") + " · "}
                  {r.ok ? (lang === "es" ? "enviada" : "sent") : `${lang === "es" ? "falló" : "failed"} (${r.status || "?"})`}
                </li>
              ))}
            </ul>
          )}
          {results.some((r) => r.ok) && (
            <p className="text-[12px] text-pmuted leading-relaxed">
              {lang === "es"
                ? "¿No te apareció? Revisa en tu celular Ajustes → Notificaciones → Sevrii (que esté permitido) y que no tengas el modo Enfoque o No molestar prendido."
                : "Didn't see it? On your phone check Settings → Notifications → Sevrii (allowed) and that Focus / Do Not Disturb is off."}
            </p>
          )}
        </div>

        {/* Email */}
        <div className={row} style={rowStyle}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[14px] font-semibold text-pfg">{t.email}</span>
            <button
              type="button"
              role="switch"
              aria-checked={s.email}
              onClick={toggleEmail}
              className="tap relative w-11 h-6 rounded-full transition-colors shrink-0"
              style={{ background: s.email ? ACCENT : "rgba(10,10,10,0.153)" }}
            >
              <span className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all" style={{ left: s.email ? 22 : 2 }} />
            </button>
          </div>
          <p className="text-[12.5px] text-psub leading-relaxed break-words">{s.email ? t.emailOn(s.ownerEmail) : t.emailOff}</p>
        </div>

        {/* SMS */}
        <div className={row} style={{ ...rowStyle, opacity: 0.6 }}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[14px] font-semibold text-pfg">{t.sms}</span>
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "rgba(10,10,10,0.068)", color: "#52525B" }}>
              {t.smsSoon}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
