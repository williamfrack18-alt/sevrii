"use client";

import { useEffect, useRef, useState } from "react";
import StoreChat from "./StoreChat";
import type { ChatChip } from "./ChatPanel";
import { useT, useLang } from "@/components/LangProvider";
import { STORE_TEXT } from "@/lib/storeI18n";
import { PLANS_TEXT } from "@/lib/plansI18n";
import { toClientBusiness, type ClientBusiness, type ClientService } from "./types";
import { chooseStartAction, fillStoreFromPlanAction, loadStoreAction, previewLinkAction, setPublishedAction } from "@/app/storeActions";
import { planFingerprint, planReadyForStore } from "@/lib/planToStore";
import type { PageDesign, PublishGap } from "@/lib/site";
import { MARKET_CATEGORY_EN, type MarketCategory } from "@/lib/marketCategories";
import { ACCENT, BRAND_BTN, GREEN, INK, TINT } from "@/lib/panel";

type Msgs = { id: string; role: string; content: string }[];
const SOFT_BTN = { background: "rgba(10,10,10,0.068)", color: "#27272A" } as const;

// Store: a narrow chat on the left and, filling the rest, the real page as it
// is right now (it reloads after every change). On a phone one button switches
// between the two. Before the page exists, the owner picks how to start it.
export default function StoreView({
  business,
  services,
  initialMessages,
  greeting,
  onUpdated,
  onMessages,
  canPublish = true,
  onPlans,
  onChats,
  onPayments,
  onBrain,
  onAgent,
  onMarketing,
}: {
  onMarketing?: () => void;
  onAgent?: () => void;
  onBrain?: () => void;
  onChats?: () => void;
  onPayments?: () => void;
  canPublish?: boolean;
  onPlans?: () => void;
  business: ClientBusiness;
  services: ClientService[];
  initialMessages: Msgs;
  greeting: string;
  onUpdated: (business: ClientBusiness, services: ClientService[]) => void;
  onMessages?: (m: Msgs) => void;
}) {
  const t = useT();
  const lang = useLang();
  const es = lang === "es";
  const st = STORE_TEXT[lang].editor;
  const lk = PLANS_TEXT[lang].lock;
  const [previewKey, setPreviewKey] = useState(0);
  const bump = () => setPreviewKey((k) => k + 1);
  // A new value opens the chat's photo/video picker.
  const [pickKey, setPickKey] = useState(0);
  // Phones: the chat or the preview, one at a time.
  const [pane, setPane] = useState<"chat" | "preview">("chat");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "gaps"; gaps: PublishGap[] } | { kind: "ok" } | { kind: "error" } | null>(null);

  async function publish(on: boolean) {
    setBusy(true);
    setNotice(null);
    try {
      const res = await setPublishedAction(on);
      if (res.upgrade) onPlans?.();
      else if (res.ok) {
        onUpdated(toClientBusiness(res.business), services);
        bump();
        if (on) setNotice({ kind: "ok" });
      } else if (res.gaps.length) setNotice({ kind: "gaps", gaps: res.gaps });
      else setNotice({ kind: "error" });
    } catch {
      setNotice({ kind: "error" });
    } finally {
      setBusy(false);
    }
  }
  const liveUrl = `/site/${business.slug}`;
  // "Editar mi página": the same preview, in edit mode (texts, parts, design).
  const [editMode, setEditMode] = useState(false);
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin === window.location.origin && e.data?.type === "sevrii-edit-done") {
        setEditMode(false);
        bump();
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  // The preview keeps its place when it reloads after a change.
  const frameRef = useRef<HTMLIFrameElement>(null);
  const scrollY = useRef(0);
  function onFrameLoad() {
    const w = frameRef.current?.contentWindow;
    if (!w) return;
    try {
      if (scrollY.current) w.scrollTo(0, scrollY.current);
      w.addEventListener("scroll", () => (scrollY.current = w.scrollY), { passive: true });
    } catch {
      // Another origin (never expected): the preview still works, from the top.
    }
  }

  // The Brain's expediente is approved and the page doesn't reflect it yet.
  const planPending = planReadyForStore(business.plan) && business.site.fromPlan !== planFingerprint(business.plan);
  const [filling, setFilling] = useState(false);
  const [fillError, setFillError] = useState(false);
  const [sync, setSync] = useState<{ key: number; messages: Msgs } | undefined>();

  // The Brain may have built the page (and written here) after this screen was
  // loaded: start from what the server has now.
  useEffect(() => {
    let alive = true;
    loadStoreAction()
      .then((res) => {
        if (!alive) return;
        onUpdated(
          toClientBusiness(res.business),
          res.services.map((x) => ({ id: x.id, name: x.name, price: x.price, description: x.description }))
        );
        if (res.messages.length !== initialMessages.length) {
          setSync({ key: Date.now(), messages: res.messages });
          onMessages?.(res.messages);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business.id]);

  const blank = business.site.start === "blank";
  const hasPage = services.length > 0 || Boolean(business.site.headline || business.pitch || business.category) || Boolean(business.serviceAgent.name) || planPending;
  const chips: ChatChip[] = blank
    ? [
        { label: es ? "Agregar mis paquetes" : "Add my packages", text: es ? "Agrega a mi página mis paquetes con sus precios." : "Add my packages with their prices to my page." },
        { label: es ? "Agregar mi presentación" : "Add my introduction", text: es ? "Agrega a mi página mi presentación." : "Add my introduction to my page." },
        { label: es ? "Agregar cómo trabajo" : "Add how I work", text: es ? "Agrega a mi página la sección de cómo trabajo." : "Add the how-I-work section to my page." },
        { label: es ? "Agregar preguntas frecuentes" : "Add FAQ", text: es ? "Agrega a mi página mis preguntas frecuentes." : "Add my FAQ to my page." },
        { label: es ? "Agregar fotos" : "Add photos", upload: true },
      ]
    : hasPage
      ? [
          { label: es ? "Agregar fotos" : "Add photos", upload: true },
          { label: es ? "Agregar un video" : "Add a video", upload: true },
          { label: es ? "Cambiar el título" : "Change the headline", text: es ? "Cambia el título de mi página a: " : "Change my page headline to: " },
          { label: es ? "Cambiar la oferta" : "Change the offer", text: es ? "Cambia la oferta: " : "Change the offer: " },
          { label: es ? "Cambiar precios" : "Change prices", text: es ? "Cambia el precio de " : "Change the price of " },
        ]
      : [];

  async function fillFromPlan() {
    setFilling(true);
    setFillError(false);
    try {
      const res = await fillStoreFromPlanAction();
      if (!res.ok) setFillError(true);
      onUpdated(
        toClientBusiness(res.business),
        res.services.map((x) => ({ id: x.id, name: x.name, price: x.price, description: x.description }))
      );
      setSync({ key: Date.now(), messages: res.messages });
      onMessages?.(res.messages);
      bump();
    } catch {
      setFillError(true);
    } finally {
      setFilling(false);
    }
  }

  // The store opens only once the Brain's strategy is approved (a page that is
  // already published stays editable). Until then: what's left, and a way back.
  if (storeLocked(business)) return <StrategyGate area="store" business={business} lang={lang} onBrain={onBrain} />;

  // Creating the store: first, how to start it.
  if (!business.published && !business.site.start)
    return (
      <StartPicker
        business={business}
        lang={lang}
        onDone={(res) => {
          onUpdated(
            toClientBusiness(res.business),
            res.services.map((x) => ({ id: x.id, name: x.name, price: x.price, description: x.description }))
          );
          setSync({ key: Date.now(), messages: res.messages });
          onMessages?.(res.messages);
          setPane("preview");
          bump();
        }}
      />
    );

  const isAgent = business.plan.mode === "agent" || Boolean(business.serviceAgent.name);
  const category = business.marketCategory ? (es ? business.marketCategory : MARKET_CATEGORY_EN[business.marketCategory as MarketCategory] ?? business.marketCategory) : "";

  return (
    <div className="h-[calc(100dvh-var(--hdr))] md:h-screen flex flex-col">
      {/* Top line, on the dark page */}
      <div className="dash-on-dark shrink-0 h-14 px-4 md:px-6 flex items-center justify-between gap-3">
        <span className="text-[17px] font-semibold text-pfg truncate min-w-0">
          {business.name} <span className="text-pmuted font-normal">· Store</span>
        </span>
        {business.site.chat && onChats && (
          <button type="button" onClick={onChats} className="hidden sm:inline-flex text-[12px] px-3 py-1 rounded-full font-medium" style={{ background: "rgba(255,255,255,0.12)", color: "#fff" }}>
            {es ? "Conversaciones" : "Conversations"}
          </button>
        )}
      </div>

      {/* Phones: one button switches between the chat and the preview */}
      <div className="md:hidden shrink-0 px-2 pb-2">
        <div className="grid grid-cols-2 p-1 rounded-full bg-white" role="tablist" aria-label={es ? "Chat o vista previa" : "Chat or preview"}>
          {(["chat", "preview"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={pane === k}
              onClick={() => setPane(k)}
              className="h-9 rounded-full text-[14px] font-semibold"
              style={pane === k ? { background: INK, color: "#fff" } : { color: INK }}
            >
              {k === "chat" ? "Chat" : es ? "Vista previa" : "Preview"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 flex">
        {/* The chat: a narrow column */}
        <section className={`${pane === "chat" ? "flex" : "hidden"} md:flex flex-col min-h-0 w-full md:w-[340px] lg:w-[380px] shrink-0`} aria-label="Chat">
          <StoreChat
            onPlans={onPlans}
            onGo={(to) => (to === "marketing" ? onMarketing?.() : to === "payments" ? onPayments?.() : onChats?.())}
            business={business}
            onBusiness={(b) => {
              onUpdated(b, services);
              bump();
            }}
            sync={sync}
            greeting={greeting}
            chips={chips}
            pickKey={pickKey}
            initialMessages={initialMessages}
            onMessages={onMessages}
            onUpdated={(b, s) => {
              onUpdated(b, s);
              bump();
            }}
          />
        </section>

        {/* The page itself, big, as it is right now */}
        <section className={`${pane === "preview" ? "flex" : "hidden"} md:flex flex-1 min-w-0 min-h-0 flex-col px-2 md:pl-0 md:pr-4 pb-2 md:pb-4`} aria-label={es ? "Vista previa de tu página" : "Preview of your page"}>
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden rounded-[24px] bg-white" style={{ boxShadow: "0 0 0 1px rgba(255,255,255,0.04), 0 30px 60px -30px rgba(0,0,0,0.85)" }}>
            <div className="shrink-0 px-3 md:px-4 py-2.5 flex flex-wrap items-center gap-2" style={{ borderBottom: "1px solid rgba(10,10,10,0.068)" }}>
              <span
                className="inline-flex items-center gap-1.5 h-7 px-3 rounded-full text-[12.5px] font-semibold max-w-full truncate"
                style={business.published ? { background: TINT, color: ACCENT } : { background: "rgba(10,10,10,0.051)", color: "#3F3F46" }}
              >
                <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: business.published ? GREEN : "#A1A1AA" }} />
                {business.published ? `${es ? "Publicada" : "Published"}${category ? ` · ${category}` : ""}` : es ? "Borrador" : "Draft"}
              </span>
              <button
                type="button"
                onClick={() => {
                  setEditMode((v) => !v);
                  bump();
                }}
                className="tap h-8 px-3.5 rounded-full text-[13px] font-semibold"
                style={editMode ? SOFT_BTN : { background: "#fff", color: INK, boxShadow: "inset 0 0 0 1px rgba(10,10,10,0.16)" }}
              >
                {editMode ? (es ? "Terminar de editar" : "Finish editing") : es ? "Editar mi página" : "Edit my page"}
              </button>
              {isAgent && onAgent && (
                <button type="button" onClick={onAgent} className="tap h-8 px-3.5 rounded-full text-[13px] font-semibold" style={SOFT_BTN}>
                  {es ? "Tu agente" : "Your agent"} →
                </button>
              )}
              <span className="grow" />
              {!business.published && <PreviewLinkButton lang={lang} />}
              <a href={liveUrl} target="_blank" rel="noopener noreferrer" className="tap h-8 inline-flex items-center px-3 rounded-full text-[13px] text-psub hover:text-pfg">
                {business.published ? t.dashboard.openLive : st.viewDraft} ↗
              </a>
              {business.published ? (
                <button type="button" disabled={busy} onClick={() => publish(false)} className="tap h-8 px-3.5 rounded-full text-[13px] font-medium disabled:opacity-50" style={SOFT_BTN}>
                  {st.unpublish}
                </button>
              ) : canPublish ? (
                <button type="button" disabled={busy} onClick={() => publish(true)} className="tap h-8 px-4 rounded-full text-[13px] font-semibold disabled:opacity-60" style={BRAND_BTN}>
                  {busy ? st.publishing : st.publish}
                </button>
              ) : (
                <button type="button" onClick={onPlans} className="tap h-8 px-3.5 rounded-full text-[13px] font-semibold" style={{ background: TINT, color: ACCENT }}>
                  {lk.publishChip} →
                </button>
              )}
            </div>

            {planPending && (
              <div className="shrink-0 mx-3 md:mx-4 mt-2.5 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center gap-3 justify-between" style={{ background: "rgba(22,163,74,0.10)" }}>
                <div className="min-w-0">
                  <p className="text-[13px] text-pfg leading-relaxed">
                    {business.site.fromPlan
                      ? es ? "Hay una versión más nueva de tu página con lo que aprobaste en el Cerebro." : "There's a newer version of your page with what you approved in the Brain."
                      : es ? "Tu estrategia está aprobada y tu página aún no la tiene." : "Your strategy is approved and your page doesn't have it yet."}
                  </p>
                  {fillError && <p className="text-[12.5px] mt-1 text-red-600">{es ? "No se pudo. Inténtalo de nuevo." : "That didn't work. Try again."}</p>}
                </div>
                <button type="button" disabled={filling} onClick={fillFromPlan} className="h-9 px-4 rounded-full text-[13px] font-semibold shrink-0 self-start sm:self-auto disabled:opacity-60" style={BRAND_BTN}>
                  {filling ? (es ? "Armando…" : "Building…") : business.site.fromPlan ? (es ? "Actualizar mi página" : "Update my page") : es ? "Armar mi página" : "Build my page"}
                </button>
              </div>
            )}

            {notice && (
              <div className="shrink-0 mx-3 md:mx-4 mt-2.5 rounded-xl px-4 py-3 text-[13.5px] text-pfg flex items-start justify-between gap-3" style={{ background: "#FFFFFF", boxShadow: "0 0 0 1px rgba(10,10,10,0.085)" }}>
                <div className="min-w-0">
                  {notice.kind === "gaps" ? (
                    <>
                      <div className="font-medium">{st.gapsTitle}</div>
                      <ul className="mt-1 text-psub list-disc pl-5">
                        {notice.gaps.map((g) => (
                          <li key={g}>{st.gaps[g]}</li>
                        ))}
                      </ul>
                    </>
                  ) : notice.kind === "ok" ? (
                    <span>
                      <span style={{ color: ACCENT }}>✓ </span>
                      {st.publishedOk}
                      {category ? ` ${st.inMarket}: ${category}.` : ""}
                      {!business.payReady && onPayments && (
                        <>
                          {" "}
                          <button type="button" onClick={onPayments} className="font-semibold underline underline-offset-2" style={{ color: ACCENT }}>
                            {es ? "Conecta tus pagos para cobrar con tarjeta →" : "Connect your payments to charge by card →"}
                          </button>
                        </>
                      )}
                    </span>
                  ) : (
                    <span>{st.publishFailed}</span>
                  )}
                </div>
                <button type="button" onClick={() => setNotice(null)} className="tap text-pmuted text-[16px] leading-none shrink-0" aria-label={st.close} title={st.close}>
                  ×
                </button>
              </div>
            )}

            <iframe
              ref={frameRef}
              key={`${business.slug}-${previewKey}-${editMode ? "e" : "v"}`}
              src={editMode ? `${liveUrl}?editar=1` : liveUrl}
              onLoad={onFrameLoad}
              title={business.published ? t.dashboard.livePageTitle : es ? "Vista previa de tu página (borrador)" : "Preview of your page (draft)"}
              className="w-full flex-1 min-h-0 border-0 block"
              style={{ background: "#fff" }}
            />
          </div>
        </section>
      </div>
    </div>
  );
}

type StartResult = Awaited<ReturnType<typeof chooseStartAction>>;

// The three ways to start the store, in this order: Sevrii's ready-to-sell
// template (recommended, picked by default), one from the gallery, or blank.
function StartPicker({ business, lang, onDone }: { business: ClientBusiness; lang: "es" | "en"; onDone: (res: StartResult) => void }) {
  const es = lang === "es";
  const [mode, setMode] = useState<"ready" | "template" | "blank">("ready");
  const [design, setDesign] = useState<PageDesign>("classic");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const designs: { id: PageDesign; name: string; text: string }[] = es
    ? [
        { id: "classic", name: "Clásica", text: "Fotos a la izquierda y tus paquetes a la derecha. Es la que usa la plantilla lista para vender." },
        { id: "hero", name: "Portada grande", text: "Una foto ancha arriba y tus datos centrados debajo." },
        { id: "simple", name: "Solo texto", text: "Sin columna de fotos: tu mensaje y tus paquetes, centrados." },
      ]
    : [
        { id: "classic", name: "Classic", text: "Photos on the left and your packages on the right. The ready-to-sell template uses it." },
        { id: "hero", name: "Big cover", text: "A wide photo on top and your details centered below." },
        { id: "simple", name: "Text only", text: "No photo column: your message and your packages, centered." },
      ];

  async function go() {
    setBusy(true);
    setError(false);
    try {
      const res = await chooseStartAction(mode, mode === "template" ? design : undefined);
      if (!res.ok) {
        setError(true);
        return;
      }
      onDone(res);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  const option = (id: "ready" | "template" | "blank", title: string, text: string, extra?: React.ReactNode, recommended = false) => {
    const on = mode === id;
    return (
      <div
        role="radio"
        aria-checked={on}
        tabIndex={0}
        onClick={() => setMode(id)}
        onKeyDown={(e) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            setMode(id);
          }
        }}
        className="rounded-[22px] bg-white p-4 md:p-5 flex flex-col gap-3 cursor-pointer text-left outline-none focus-visible:ring-2"
        style={{ boxShadow: on ? `0 0 0 2px ${GREEN}, 0 10px 30px -14px rgba(10,10,10,.25)` : "0 0 0 1px rgba(10,10,10,.08)" }}
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 h-5 w-5 rounded-full shrink-0 flex items-center justify-center" style={{ boxShadow: `inset 0 0 0 2px ${on ? GREEN : "rgba(10,10,10,.25)"}` }} aria-hidden="true">
            {on && <span className="h-2.5 w-2.5 rounded-full" style={{ background: GREEN }} />}
          </span>
          <div className="min-w-0 flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[16.5px] font-semibold" style={{ color: INK }}>{title}</span>
              {recommended && (
                <span className="inline-flex items-center h-6 px-2.5 rounded-full text-[11.5px] font-bold uppercase tracking-[0.06em]" style={{ background: TINT, color: ACCENT }}>
                  {es ? "Recomendada" : "Recommended"}
                </span>
              )}
            </div>
            <p className="text-[14px] leading-relaxed text-psub">{text}</p>
          </div>
        </div>
        {extra}
      </div>
    );
  };

  return (
    <div className="min-h-[calc(100dvh-var(--hdr))] md:min-h-screen px-4 py-6 md:py-10 flex justify-center">
      <div className="w-full max-w-[960px] flex flex-col gap-5">
        <div className="dash-on-dark flex flex-col gap-2">
          <span className="text-[12px] font-semibold uppercase tracking-[0.08em]" style={{ color: "#4ADE80" }}>
            {es ? "Store · tu estrategia está aprobada" : "Store · your strategy is approved"}
          </span>
          <h1 className="text-[26px] md:text-[34px] font-light tracking-[-0.02em] text-pfg leading-tight">{es ? "¿Cómo quieres crear tu página?" : "How do you want to create your page?"}</h1>
          <p className="text-[14.5px] text-psub leading-relaxed max-w-[680px]">
            {es
              ? `Todo se arma con lo que aprobaste en el Cerebro para ${business.name}: tu servicio, tus paquetes, tus precios y tu oferta. No inventamos fotos, testimonios ni precios.`
              : `Everything is built from what you approved in the Brain for ${business.name}: your service, packages, prices and offer. We never invent photos, testimonials or prices.`}
          </p>
        </div>

        <div role="radiogroup" aria-label={es ? "Cómo empezar tu página" : "How to start your page"} className="flex flex-col gap-3">
          {option(
            "ready",
            es ? "Plantilla lista para vender" : "Ready-to-sell template",
            es
              ? "La plantilla de alta conversión de Sevrii, ya hecha y optimizada para vender. Solo completas tus datos y tu página queda lista."
              : "Sevrii's high-converting template, already built and optimized to sell. You only complete your details and your page is ready.",
            <Thumb slug={business.slug} design="classic" label={es ? "Tu página con la plantilla lista para vender" : "Your page with the ready-to-sell template"} />,
            true
          )}
          {option(
            "template",
            es ? "Elegir una plantilla" : "Pick a template",
            es ? "Mira las plantillas que tenemos con tus datos y escoge la que prefieras. Luego completas lo que falte." : "See our templates with your details and pick the one you like. Then complete what's missing.",
            mode === "template" ? (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" role="radiogroup" aria-label={es ? "Plantillas" : "Templates"} onClick={(e) => e.stopPropagation()}>
                {designs.map((d) => {
                  const on = design === d.id;
                  return (
                    <button
                      key={d.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => setDesign(d.id)}
                      className="rounded-2xl p-2 flex flex-col gap-2 text-left"
                      style={{ boxShadow: on ? `0 0 0 2px ${GREEN}` : "0 0 0 1px rgba(10,10,10,.1)" }}
                    >
                      <Thumb slug={business.slug} design={d.id} label={d.name} />
                      <span className="px-1 text-[14px] font-semibold" style={{ color: INK }}>
                        {on ? "✓ " : ""}
                        {d.name}
                      </span>
                      <span className="px-1 pb-1 text-[12.5px] leading-snug text-psub">{d.text}</span>
                    </button>
                  );
                })}
              </div>
            ) : undefined
          )}
          {option(
            "blank",
            es ? "Construir desde cero" : "Build from scratch",
            es
              ? "Una página en blanco para armarla a tu manera: le pides al chat cada parte o la muestras tocando la página, siempre con lo que aprobaste."
              : "A blank page to build your way: ask the chat for each part or show it by tapping the page, always with what you approved."
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button type="button" disabled={busy} onClick={go} className="h-11 px-6 rounded-full text-[15px] font-semibold disabled:opacity-60" style={{ background: "#fff", color: INK }}>
            {busy ? (es ? "Armando tu página…" : "Building your page…") : es ? "Continuar" : "Continue"}
          </button>
          {error && <span className="text-[13.5px]" style={{ color: "#FCA5A5" }}>{es ? "No se pudo crear tu página. Inténtalo otra vez." : "Couldn't create your page. Try again."}</span>}
        </div>
      </div>
    </div>
  );
}

// The owner's own page in one design, small and not clickable (a real page,
// not a drawing: the template as it will look with their approved content).
function Thumb({ slug, design, label }: { slug: string; design: PageDesign; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.25);
  const W = 1280;
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(el.clientWidth / W));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={box} className="relative w-full aspect-[16/10] overflow-hidden rounded-xl bg-white" style={{ boxShadow: "inset 0 0 0 1px rgba(10,10,10,.08)" }}>
      <iframe
        src={`/site/${slug}?diseno=${design}`}
        title={label}
        tabIndex={-1}
        aria-hidden="true"
        loading="lazy"
        className="absolute top-0 left-0 border-0 pointer-events-none origin-top-left"
        style={{ width: W, height: (W * 10) / 16, transform: `scale(${scale})` }}
      />
    </div>
  );
}

// Draft pages: a link to show the page to someone before publishing.
function PreviewLinkButton({ lang }: { lang: "es" | "en" }) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");
  const es = lang === "es";
  async function copy() {
    try {
      const url = await previewLinkAction();
      await navigator.clipboard.writeText(url);
      setState("copied");
    } catch {
      setState("error");
    }
    setTimeout(() => setState("idle"), 2600);
  }
  return (
    <button
      type="button"
      onClick={copy}
      title={es ? "Cualquiera con este enlace ve tu borrador. El chat y los pagos se activan al publicar." : "Anyone with this link sees your draft. Chat and payments switch on when you publish."}
      className="hidden sm:inline-flex text-[12px] px-3 py-1 rounded-full font-medium"
      style={{ background: "rgba(10,10,10,0.068)", color: "#27272A" }}
    >
      {state === "copied" ? (es ? "Enlace copiado" : "Link copied") : state === "error" ? (es ? "No se pudo copiar, inténtalo otra vez" : "Couldn't copy, try again") : es ? "Copiar enlace de vista previa" : "Copy preview link"}
    </button>
  );
}

export function storeLocked(b: ClientBusiness): boolean {
  return !b.published && b.plan.stage !== "approved";
}

// What's still missing in the Brain, said plainly, with one button back to it.
export function StrategyGate({ area, business, lang, onBrain }: { area: "store" | "marketing"; business: ClientBusiness; lang: "es" | "en"; onBrain?: () => void }) {
  const es = lang === "es";
  const p = business.plan;
  const parts = es
    ? { service: "tu servicio", pitch: "cómo te presentas", packages: "tus paquetes y precios", offer: "tu oferta de bienvenida", faq: "tus preguntas frecuentes" }
    : { service: "your service", pitch: "how you present yourself", packages: "your packages and prices", offer: "your welcome offer", faq: "your FAQ" };
  const pending = (Object.keys(parts) as (keyof typeof parts)[]).filter((k) => !p.approvals[k]);
  const where =
    p.stage === "interview" || p.stage === "ready_check"
      ? es ? "Todavía estás en la entrevista con el Cerebro: contesta sus preguntas para que investigue tu zona." : "You're still in the interview with the Brain: answer its questions so it can research your area."
      : p.stage === "ideas_research" || p.stage === "research"
        ? es ? "El Cerebro está investigando tu zona. En 1 o 2 minutos te muestra tu propuesta." : "The Brain is researching your area. In 1-2 minutes it shows you your proposal."
        : p.stage === "choose"
          ? es ? "Escoge una de las 3 ideas que te propuso el Cerebro." : "Pick one of the 3 ideas the Brain proposed."
          : es ? `Te falta aprobar en el Cerebro: ${pending.map((k) => parts[k]).join(", ")}.` : `Still to approve in the Brain: ${pending.map((k) => parts[k]).join(", ")}.`;
  return (
    <div className="min-h-[calc(100dvh-var(--hdr))] md:min-h-screen flex items-center justify-center px-4">
      <div className="max-w-[520px] w-full rounded-[24px] bg-white p-6 md:p-8 flex flex-col gap-4" style={{ boxShadow: "0 0 0 1px rgba(10,10,10,.06), 0 10px 30px -14px rgba(10,10,10,.16)" }}>
        <span className="text-[12px] font-semibold uppercase tracking-[0.08em]" style={{ color: ACCENT }}>
          {area === "marketing" ? (es ? "Marketing · se abre al aprobar tu estrategia" : "Marketing · opens when your strategy is approved") : es ? "Store · se abre al aprobar tu estrategia" : "Store · opens when your strategy is approved"}
        </span>
        <h1 className="text-[22px] font-semibold text-pfg leading-tight">{es ? "Primero terminemos tu estrategia" : "Let's finish your strategy first"}</h1>
        <p className="text-[14.5px] text-psub leading-relaxed">
          {area === "marketing"
            ? es
              ? "Tus anuncios y tus videos se arman con lo que apruebes en el Cerebro: tu servicio, tus precios y tu oferta. Por eso Marketing se abre cuando tu estrategia esté aprobada."
              : "Your ads and videos are built from what you approve in the Brain: your service, prices and offer. That's why Marketing opens once your strategy is approved."
            : es
              ? "Tu tienda se arma sola con lo que apruebes en el Cerebro: tu servicio, tus precios, tu oferta y tus preguntas frecuentes. Por eso se abre cuando tu estrategia esté aprobada."
              : "Your store builds itself from what you approve in the Brain: your service, prices, offer and FAQ. That's why it opens once your strategy is approved."}
        </p>
        <p className="text-[14.5px] text-pfg leading-relaxed">{where}</p>
        {onBrain && (
          <button type="button" onClick={onBrain} className="self-start h-11 px-6 rounded-full text-[14.5px] font-semibold" style={BRAND_BTN}>
            {es ? "Ir al Cerebro a terminarla" : "Go to the Brain to finish it"}
          </button>
        )}
      </div>
    </div>
  );
}
