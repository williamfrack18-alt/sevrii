// Shared by the server page and the client parts of the store template.
export type ContactChannel = "call" | "text" | "whatsapp" | "chat";

export function channelClass(c: ContactChannel, primary: boolean): string {
  if (!primary) return "ghost";
  return c === "whatsapp" ? "wa" : c === "chat" ? "chat" : "";
}

export const CHAT_HEAD = {
  es: { eyebrow: "Chat en vivo", title: "¿Tienes preguntas?", sub: (biz: string) => `Escríbenos aquí: te respondemos al instante y ${biz} confirma tu cita.`, open: "Escribir ahora" },
  en: { eyebrow: "Live chat", title: "Got questions?", sub: (biz: string) => `Message us here: you get an instant answer and ${biz} confirms your appointment.`, open: "Message us now" },
};
