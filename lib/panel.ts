// The provider's panel (dashboard): light, warm and clean. White cards with
// big rounded corners and a soft shadow on a light page, black pill buttons,
// Sevrii's green for what's on / done / good, deep green for featured cards.
// Only black, white and green (never violet).
export const ACCENT = "#15803D"; // green text and icons on white (≈ #16A34A, readable)
export const GREEN = "#16A34A"; // fills: dots, rings, progress
export const DEEP = "#052E16"; // featured cards, the owner's chat bubbles
export const RING = "#16A34A"; // outline of the selected card
export const TINT = "#DCFCE7"; // soft fill behind green text
export const INK = "#0A0A0A";
export const BRAND_BG = INK;
// Primary action: black pill with white text.
export const BRAND_BTN = { background: INK, color: "#fff" } as const;
// Big white card: very rounded, soft shadow, hairline.
export const CARD = { background: "#fff", boxShadow: "0 1px 2px rgba(10,10,10,.04), 0 8px 24px -12px rgba(10,10,10,.10), 0 0 0 1px rgba(10,10,10,.05)" } as const;
