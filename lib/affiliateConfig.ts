// A business's affiliate program: open or not, the commission it pays on
// payments made through Sevrii, and a note for the people promoting it.
// Pure data, shared by server and UI.

export type AffiliateSettings = {
  enabled: boolean;
  percent: number; // 5–50, on the amount the customer paid
  pitch: string; // for affiliates: who the customer is, what to say, what not to promise
};

export const AFF_MIN_PERCENT = 5;
export const AFF_MAX_PERCENT = 50;
export const AFF_HOLD_DAYS = 30; // commissions are paid after this, so refunds can be caught
export const AFF_COOKIE_DAYS = 30; // a visit counts for this long

export function parseAffiliate(raw: unknown): AffiliateSettings {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const p = Math.round(Number(o.percent));
  return {
    enabled: o.enabled === true,
    percent: Number.isFinite(p) ? Math.max(AFF_MIN_PERCENT, Math.min(AFF_MAX_PERCENT, p)) : 20,
    pitch: typeof o.pitch === "string" ? o.pitch.replace(/\u0000/g, "").trim().slice(0, 600) : "",
  };
}

export const affCookieName = (businessId: string) => `saff_${businessId}`;
export const commissionOf = (amountCents: number, percent: number) => Math.floor((amountCents * percent) / 100);
