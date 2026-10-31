"use client";

import { useEffect, useState } from "react";
import StoreChat from "./StoreChat";
import StoreSummary from "./StoreSummary";
import { Sheet } from "./ProjectDock";
import type { ChatChip } from "./ChatPanel";
import { useT, useLang } from "@/components/LangProvider";
import { STORE_TEXT } from "@/lib/storeI18n";
import { PLANS_TEXT } from "@/lib/plansI18n";
import { toClientBusiness, type ClientBusiness, type ClientService } from "./types";
import { fillStoreFromPlanAction, loadStoreAction, previewLinkAction, setPublishedAction } from "@/app/storeActions";
import { planFingerprint, planReadyForStore } from "@/lib/planToStore";
import type { PublishGap } from "@/lib/site";
import { MARKET_CATEGORY_EN, type MarketCategory } from "@/lib/marketCategories";
import { ACCENT, BRAND_BTN, TINT } from "@/lib/panel";

// Store = one chat that starts with a summary of the page (what it has, what
// it lacks, the agent) and changes it; the page itself sits right below.
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
}: {
  onAgent?: () => void;
  onBrain?: () => void;
  onChats?: () => void;
  onPayments?: () => void;
  canPublish?: boolean;
  onPlans?: () => void;
  business: ClientBusiness;
  services: ClientService[];
  initialMessages: { id: string; role: string; content: string }[];
  greeting: string;
  onUpdated: (business: ClientBusiness, services: ClientService[]) => void;
  onMessages?: (m: { id: string; role: string; content: string }[]) => void;
}) {
  const t = useT();
  const lang = useLang();
  const st = STORE_TEXT[lang].editor;
  const lk = PLANS_TEXT[lang].lock;
  const [previewKey, setPreviewKey] = useState(0);
  // A new value opens the chat's photo/video picker (from "Subir fotos o video").
  const [pickKey, setPickKey] = useState(0);
  // The page opens from the chat (full screen) and closes back to it.
  const [pageOpen, setPageOpen] = useState(false);
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
        setPreviewKey((k) => k + 1);
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

  // The Brain's expediente is approved and the page doesn't reflect it yet.
  const planPending = planReadyForStore(business.plan) && business.site.fromPlan !== planFingerprint(business.plan);
  const [filling, setFilling] = useState(false);
  const [fillError, setFillError] = useState(false);
  const [sync, setSync] = useState<{ key: number; messages: { id: string; role: string; content: string }[] } | undefined>();

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

  const hasPage = services.length > 0 || Boolean(business.site.headline || business.pitch || business.category) || Boolean(business.serviceAgent.name) || planPending;
  const es = lang === "es";
  const chips: ChatChip[] = hasPage
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
      setPreviewKey((k) => k + 1);
    } catch {
      setFillError(true);
    } finally {
      setFilling(false);
    }
  }

  // The store opens only once the Brain's strategy is approved (a page that is
  // already published stays editable). Until then: what's left, and a way back.
  if (storeLocked(business)) return <StoreLocked business={business} lang={lang} onBrain={onBrain} />;

  return (
    <div style={{ background: "#F5F5F3" }}>
      {/* Chat: fills the screen, composer pinned at the bottom */}
      <section
        className="h-[calc(100dvh-var(--hdr))] md:h-screen flex flex-col"
      >
        <div className="shrink-0 h-14 px-4 md:px-6 flex items-center justify-between gap-3">
          <span className="text-[17px] font-semibold text-pfg truncate min-w-0">
            {business.name} <span className="text-pmuted font-normal">· Store</span>
          </span>
          <div className="flex items-center gap-2 shrink-0">
            {business.site.chat && (
              <button type="button" onClick={onChats} className="hidden sm:inline-flex text-[12px] px-3 py-1 rounded-full font-medium" style={{ background: "rgba(10,10,10,0.068)", color: "#27272A" }}>
                {lang === "es" ? "Conversaciones" : "Conversations"}
              </button>
            )}
            {business.published ? (
              <>
                {business.marketCategory && (
                  <a
                    href={lang === "es" ? "/#explorar" : "/en#explorar"}
                    target="_blank"
                    rel="noreferrer"
                    className="hidden sm:inline-flex text-[12px] px-3 py-1 rounded-full font-medium"
                    style={{ background: "rgba(10,10,10,0.051)", color: "#27272A" }}
                  >
                    {st.inMarket}: {lang === "es" ? business.marketCategory : MARKET_CATEGORY_EN[business.marketCategory as MarketCategory] ?? business.marketCategory}
                  </a>
                )}
                <a href="#" onClick={(e) => { e.preventDefault(); setPageOpen(true); }} className="tap text-[12px] px-3 py-1 rounded-full font-medium" style={{ background: TINT, color: ACCENT }}>
                  {st.live}
                </a>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => publish(false)}
                  className="tap text-[12px] px-3 py-1 rounded-full font-medium disabled:opacity-50"
                  style={{ background: "rgba(10,10,10,0.068)", color: "#27272A" }}
                >
                  {st.unpublish}
                </button>
              </>
            ) : canPublish ? (
              <>
                <a href="#" onClick={(e) => { e.preventDefault(); setPageOpen(true); }} className="hidden sm:inline-flex text-[12px] px-3 py-1 rounded-full font-medium" style={{ background: "rgba(10,10,10,0.068)", color: "#27272A" }}>
                  {st.draft}
                </a>
                <PreviewLinkButton lang={lang} />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => publish(true)}
                  className="tap h-8 px-4 rounded-full text-[13px] font-semibold disabled:opacity-60"
                  style={BRAND_BTN}
                >
                  {busy ? st.publishing : st.publish}
                </button>
              </>
            ) : (
              <>
                <a href="#" onClick={(e) => { e.preventDefault(); setPageOpen(true); }} className="hidden sm:inline-flex text-[12px] px-3 py-1 rounded-full font-medium" style={{ background: "rgba(10,10,10,0.068)", color: "#27272A" }}>
                  {st.draft}
                </a>
                <PreviewLinkButton lang={lang} />
                <button type="button" onClick={onPlans} className="tap text-[12px] px-3 py-1 rounded-full font-semibold" style={{ background: TINT, color: ACCENT }}>
                  {lk.publishChip} →
                </button>
              </>
            )}
          </div>
        </div>
        {notice && (
          <div className="shrink-0 mx-4 md:mx-6 mb-2 rounded-xl px-4 py-3 text-[13.5px] text-pfg flex items-start justify-between gap-3" style={{ background: "#FFFFFF", boxShadow: "0 0 0 1px rgba(10,10,10,0.085)" }}>
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
                  {business.marketCategory ? ` ${st.inMarket}: ${lang === "es" ? business.marketCategory : MARKET_CATEGORY_EN[business.marketCategory as MarketCategory] ?? business.marketCategory}.` : ""}
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
        <StoreChat
          onPlans={onPlans}
          business={business}
          onBusiness={(b) => {
            onUpdated(b, services);
            setPreviewKey((k) => k + 1);
          }}
          sync={sync}
          greeting={greeting}
          chips={chips}
          pickKey={pickKey}
          dockLabel={lang === "es" ? "Tu página: resumen" : "Your page: summary"}
          dock={
            hasPage ? (
              <StoreSummary
                business={business}
                services={services}
                planPending={planPending}
                filling={filling}
                fillError={fillError}
                onFill={fillFromPlan}
                onOpenPage={() => setPageOpen(true)}
                onPayments={onPayments}
                onAgent={onAgent}
                onAddMedia={() => setPickKey(Date.now())}
                onUpdated={(b) => {
                  onUpdated(b, services);
                  setPreviewKey((k) => k + 1);
                }}
              />
            ) : business.plan.mode && business.plan.stage !== "approved" ? (
              // The Brain strategy isn't done yet: say where the page comes from
              // instead of a blank "what do you want to sell?".
              <div className="p-card p-5 flex flex-col gap-3">
                <span className="text-[12px] font-medium uppercase tracking-[0.08em] text-pmuted">{es ? "Tu página" : "Your page"}</span>
                <span className="text-[17px] font-medium text-pfg leading-snug">{es ? `${business.name}: todavía en borrador y sin contenido` : `${business.name}: still a draft with no content`}</span>
                <p className="text-[13.5px] text-pfg2 leading-relaxed">
                  {es
                    ? "Tu página se arma con la estrategia del Cerebro (servicio, precios y oferta). Cuando la apruebes allí, la armo aquí con todo. Si prefieres, cuéntame ya en este chat qué vendes y a qué precio."
                    : "Your page is built from your Brain strategy (service, prices and offer). Once you approve it there, I build it here with everything. Or tell me right now in this chat what you sell and at what price."}
                </p>
                {onBrain && (
                  <button type="button" onClick={onBrain} className="self-start h-10 px-5 rounded-full text-[14px] font-semibold" style={BRAND_BTN}>
                    {es ? "Ir a Cerebro" : "Go to Brain"}
                  </button>
                )}
              </div>
            ) : undefined
          }
          initialMessages={initialMessages}
          onMessages={onMessages}
          onUpdated={(b, s) => {
            onUpdated(b, s);
            setPreviewKey((k) => k + 1);
          }}
        />
      </section>

      {/* The page, below the chat */}
      <Sheet open={pageOpen} title={business.published ? st.yourPage : es ? "Vista previa de tu página" : "Preview of your page"} onClose={() => setPageOpen(false)} wide>
        <div className="flex flex-col h-full">
          <div className="shrink-0 px-4 md:px-5 py-2.5 flex justify-end">
            <a href={liveUrl} target="_blank" rel="noopener noreferrer" className="tap text-[13px] text-psub hover:text-pfg">
              {business.published ? t.dashboard.openLive : st.viewDraft} ↗
            </a>
          </div>
          <iframe key={`${business.slug}-${previewKey}`} src={liveUrl} title={business.published ? t.dashboard.livePageTitle : es ? "Vista previa de tu página (borrador)" : "Preview of your page (draft)"} className="w-full flex-1 min-h-[70vh] border-0 block" style={{ background: "#fff" }} />
        </div>
      </Sheet>
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
function StoreLocked({ business, lang, onBrain }: { business: ClientBusiness; lang: "es" | "en"; onBrain?: () => void }) {
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
    <div className="min-h-[calc(100dvh-var(--hdr))] md:min-h-screen flex items-center justify-center px-4" style={{ background: "#F5F5F3" }}>
      <div className="max-w-[520px] w-full rounded-[24px] bg-white p-6 md:p-8 flex flex-col gap-4" style={{ boxShadow: "0 0 0 1px rgba(10,10,10,.06), 0 10px 30px -14px rgba(10,10,10,.16)" }}>
        <span className="text-[12px] font-semibold uppercase tracking-[0.08em]" style={{ color: ACCENT }}>{es ? "Store · se abre al aprobar tu estrategia" : "Store · opens when your strategy is approved"}</span>
        <h1 className="text-[22px] font-semibold text-pfg leading-tight">{es ? "Primero terminemos tu estrategia" : "Let's finish your strategy first"}</h1>
        <p className="text-[14.5px] text-psub leading-relaxed">
          {es
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
