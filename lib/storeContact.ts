// Shared by the server page and the client parts of the store template.
export type ContactChannel = "call" | "text" | "whatsapp" | "form";

export function channelClass(c: ContactChannel, primary: boolean): string {
  if (!primary) return "ghost";
  return c === "whatsapp" ? "wa" : c === "form" ? "quote" : "";
}

export const QUOTE_HEAD = {
  es: { eyebrow: "Cotización gratis", title: "Pide tu cotización", sub: (biz: string) => `Déjanos tus datos y ${biz} te contacta.` },
  en: { eyebrow: "Free quote", title: "Get your free quote", sub: (biz: string) => `Leave your details and ${biz} will get back to you.` },
};
