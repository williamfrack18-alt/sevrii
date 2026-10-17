// Shared by the server page and the client parts of the store template.
export type ContactChannel = "call" | "text" | "whatsapp" | "chat";

export function channelClass(c: ContactChannel, primary: boolean): string {
  if (!primary) return "ghost";
  return c === "whatsapp" ? "wa" : c === "chat" ? "chat" : "";
}
