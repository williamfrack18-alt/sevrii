// Shared by the server page and the client parts of the store template.
export type ContactChannel = "call" | "text" | "whatsapp" | "chat";

export function channelClass(c: ContactChannel, primary: boolean): string {
  if (!primary) return "ghost";
  return c === "whatsapp" ? "wa" : c === "chat" ? "chat" : "";
}

export const CHAT_HEAD = {
  es: { eyebrow: "Chat en vivo", title: "¿Tienes preguntas?", sub: (biz: string) => `Escríbenos por aquí y te respondemos al instante. En ${biz} te ayudamos a elegir y a agendar.`, open: "Escribir ahora" },
  en: { eyebrow: "Live chat", title: "Got questions?", sub: (biz: string) => `Message us here and we reply right away. At ${biz} we help you choose and book.`, open: "Message us now" },
};
