"use client";

import { useEffect, useState } from "react";
import { loadConnectAndInitialize, type StripeConnectInstance } from "@stripe/connect-js";
import {
  ConnectAccountManagement,
  ConnectAccountOnboarding,
  ConnectComponentsProvider,
  ConnectNotificationBanner,
  ConnectPayments,
  ConnectPayouts,
} from "@stripe/react-connect-js";
import { connectSessionAction } from "@/app/paymentsActions";
import SevriiLoader from "@/components/SevriiLoader";

// Sevrii Payments, like Shopify Payments: the owner signs up with Stripe, sees
// their payments, refunds, disputes, balance and deposits, and changes their
// bank account without leaving Sevrii. These are Stripe's own embedded
// screens (Stripe Connect), painted in the panel's dark green. Stripe still
// holds the money and covers fraud and chargebacks, as before.

const APPEARANCE = {
  overlays: "dialog" as const,
  variables: {
    colorPrimary: "#86CFA5",
    colorBackground: "#07160d",
    colorText: "#F3F6F4",
    colorSecondaryText: "#A7B3AC",
    colorBorder: "#22352A",
    colorDanger: "#F87171",
    buttonPrimaryColorBackground: "#FFFFFF",
    buttonPrimaryColorBorder: "#FFFFFF",
    buttonPrimaryColorText: "#0A0A0A",
    buttonSecondaryColorBackground: "#0F2219",
    buttonSecondaryColorBorder: "#2A4034",
    buttonSecondaryColorText: "#FFFFFF",
    actionPrimaryColorText: "#86CFA5",
    actionSecondaryColorText: "#C9D3CD",
    badgeSuccessColorBackground: "#123524",
    badgeSuccessColorText: "#86CFA5",
    badgeSuccessColorBorder: "#1D4A33",
    badgeNeutralColorBackground: "#15261C",
    badgeNeutralColorText: "#C9D3CD",
    badgeNeutralColorBorder: "#2A4034",
    badgeWarningColorBackground: "#33270F",
    badgeWarningColorText: "#F5C451",
    badgeWarningColorBorder: "#4A3A17",
    badgeDangerColorBackground: "#3A1515",
    badgeDangerColorText: "#F87171",
    badgeDangerColorBorder: "#5A2020",
    offsetBackgroundColor: "#0B1D13",
    formBackgroundColor: "#0B1D13",
    formHighlightColorBorder: "#86CFA5",
    formAccentColor: "#86CFA5",
    borderRadius: "12px",
    buttonBorderRadius: "999px",
    formBorderRadius: "12px",
    overlayBorderRadius: "20px",
    overlayBackdropColor: "rgba(0, 0, 0, 0.6)",
    overlayZIndex: 100,
  },
};

// One Stripe instance per open dashboard (and per project).
let shared: { key: string; instance: StripeConnectInstance } | null = null;

function instanceFor(publishableKey: string, businessId: string, lang: "es" | "en"): StripeConnectInstance {
  const key = `${publishableKey}:${businessId}`;
  if (shared && shared.key === key) return shared.instance;
  shared?.instance.logout().catch(() => {});
  const instance = loadConnectAndInitialize({
    publishableKey,
    // Each call makes a fresh session (they last a short while).
    fetchClientSecret: async () => {
      const r = await connectSessionAction();
      if (!r.secret) throw new Error(r.error || "failed");
      return r.secret;
    },
    appearance: APPEARANCE,
    locale: lang === "es" ? "es-419" : "en-US",
  });
  shared = { key, instance };
  return instance;
}

function useInstance(publishableKey: string, businessId: string, lang: "es" | "en") {
  const [instance, setInstance] = useState<StripeConnectInstance | null>(null);
  useEffect(() => {
    setInstance(instanceFor(publishableKey, businessId, lang));
  }, [publishableKey, businessId, lang]);
  return instance;
}

type Common = { publishableKey: string; businessId: string; lang: "es" | "en" };

function Shell({ instance, children, lang }: { instance: StripeConnectInstance | null; children: React.ReactNode; lang: "es" | "en" }) {
  if (!instance) return <Loading lang={lang} />;
  return <ConnectComponentsProvider connectInstance={instance}>{children}</ConnectComponentsProvider>;
}

function Loading({ lang }: { lang: "es" | "en" }) {
  return (
    <div className="py-10 flex justify-center">
      <SevriiLoader label={lang === "es" ? "Cargando…" : "Loading…"} />
    </div>
  );
}

// Signing up (or finishing what Stripe still asks), right inside Sevrii.
export function StripeOnboarding({ publishableKey, businessId, lang, onExit }: Common & { onExit: () => void }) {
  const instance = useInstance(publishableKey, businessId, lang);
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <p className="text-[14px] text-red-600">{lang === "es" ? "No se pudo abrir el registro. Recarga la página e inténtalo de nuevo." : "Couldn't open the sign-up. Reload the page and try again."}</p>;
  }
  return (
    <Shell instance={instance} lang={lang}>
      <ConnectAccountOnboarding
        onExit={onExit}
        fullTermsOfServiceUrl="https://stripe.com/legal/ssa"
        privacyPolicyUrl="https://stripe.com/privacy"
        onLoadError={() => setFailed(true)}
      />
    </Shell>
  );
}

// What Stripe needs from the owner (a document, a detail): shows only when there's something.
export function StripeBanner(props: Common) {
  const instance = useInstance(props.publishableKey, props.businessId, props.lang);
  if (!instance) return null;
  return (
    <ConnectComponentsProvider connectInstance={instance}>
      <ConnectNotificationBanner />
    </ConnectComponentsProvider>
  );
}

type Tab = "payouts" | "payments" | "account";

// "Tu dinero": deposits and balance, every payment (refunds, disputes), and the bank account.
export function StripeMoney({ publishableKey, businessId, lang }: Common) {
  const instance = useInstance(publishableKey, businessId, lang);
  const [tab, setTab] = useState<Tab>("payouts");
  const [failed, setFailed] = useState(false);
  const es = lang === "es";
  const tabs: [Tab, string][] = [
    ["payouts", es ? "Depósitos y saldo" : "Deposits and balance"],
    ["payments", es ? "Pagos, reembolsos y disputas" : "Payments, refunds and disputes"],
    ["account", es ? "Cuenta bancaria y datos" : "Bank account and details"],
  ];
  return (
    <section className="flex flex-col gap-4 min-w-0">
      <div className="flex flex-col gap-1">
        <div className="text-[17px] font-[500]">{es ? "Tu dinero" : "Your money"}</div>
        <p className="text-[13.5px] text-muted leading-relaxed">
          {es
            ? "Todo sin salir de Sevrii: cuándo te llega el dinero, cada pago, reembolsos, disputas y tu cuenta de banco."
            : "All without leaving Sevrii: when your money arrives, every payment, refunds, disputes and your bank account."}
        </p>
      </div>
      <div className="seg inline-flex self-start max-w-full overflow-x-auto rounded-full p-1 gap-1" role="tablist">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`seg-btn ${tab === id ? "on" : ""} shrink-0 h-9 px-4 rounded-full text-[13px] font-medium whitespace-nowrap`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="min-w-0 min-h-[240px]">
        {failed ? (
          <p className="text-[14px] text-muted">
            {es ? "No se pudo cargar esta parte. Recarga la página; si sigue igual, revisa que ningún bloqueador de anuncios esté frenando a Stripe." : "This part couldn't load. Reload the page; if it keeps happening, check that no ad blocker is stopping Stripe."}
          </p>
        ) : (
          <Shell instance={instance} lang={lang}>
            {tab === "payouts" && <ConnectPayouts onLoadError={() => setFailed(true)} />}
            {tab === "payments" && <ConnectPayments onLoadError={() => setFailed(true)} />}
            {tab === "account" && <ConnectAccountManagement onLoadError={() => setFailed(true)} />}
          </Shell>
        )}
      </div>
    </section>
  );
}
