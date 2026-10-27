// The practice office: what the agent operates when there's no real cloud
// browser yet (test mode). It behaves like an official site — a form, a review
// page with a submit button, a payment page where only the customer types the
// card (in the live view), and a confirmation with a number and a receipt — so
// the whole flow (operate, ask what's sensitive, confirm, verify, deliver) can
// be tried without sending anything real. Everything it shows says "PRUEBA".

import type { PageButton, PageField, PageView } from "./browser";

export type SandboxState = {
  page: "start" | "form" | "review" | "pay" | "done";
  values: Record<string, string>;
  cardEntered: boolean;
  confirmation: string;
  platform: string;
  needs: string[];
};

const URL = "https://practica.sevrii.com";

function formFields(sb: SandboxState): PageField[] {
  const names = sb.needs.length ? sb.needs : ["Nombre completo", "Correo electrónico"];
  return names.slice(0, 12).map((label, i) => ({ id: `f${i + 1}`, label, type: "text", value: sb.values[`f${i + 1}`] || "", sensitive: false, required: true }));
}

export function sandboxRead(sb: SandboxState): PageView {
  const head = `OFICINA DE PRÁCTICA (MODO DE PRUEBA) — simula: ${sb.platform}. Nada de lo que se hace aquí es real.`;
  if (sb.page === "start") {
    return { url: `${URL}/`, title: "Oficina de práctica", text: `${head} Bienvenido. Para empezar la solicitud toque "Iniciar solicitud".`, fields: [], buttons: [{ id: "b1", label: "Iniciar solicitud", kind: "button" }], captcha: false };
  }
  if (sb.page === "form") {
    const fields = formFields(sb);
    return { url: `${URL}/solicitud`, title: "Solicitud", text: `${head} Paso 1 de 3: complete todos los campos y toque "Continuar".`, fields, buttons: [{ id: "b20", label: "Continuar", kind: "button" }], captcha: false };
  }
  if (sb.page === "review") {
    const list = formFields(sb)
      .map((f) => `${f.label}: ${f.value || "(vacío)"}`)
      .join(" · ");
    const buttons: PageButton[] = [
      { id: "b21", label: "Corregir", kind: "button" },
      { id: "b22", label: "Firmar y enviar solicitud", kind: "button" },
    ];
    return { url: `${URL}/revision`, title: "Revisión", text: `${head} Paso 2 de 3: revise los datos. ${list}. Al tocar "Firmar y enviar solicitud" el solicitante firma electrónicamente.`, fields: [], buttons, captcha: false };
  }
  if (sb.page === "pay") {
    const fields: PageField[] = [{ id: "f30", label: "Número de tarjeta (prueba)", type: "text", value: sb.cardEntered ? "[filled by the customer]" : "", sensitive: true, required: true }];
    return {
      url: `${URL}/pago`,
      title: "Pago",
      text: `${head} Paso 3 de 3: pago de la tarifa (prueba: $0, use la tarjeta de prueba 4242 4242 4242 4242). ${sb.cardEntered ? "Tarjeta ingresada." : "Falta la tarjeta."}`,
      fields,
      buttons: [{ id: "b31", label: "Pagar", kind: "button" }],
      captcha: false,
    };
  }
  return {
    url: `${URL}/confirmacion`,
    title: "Confirmación",
    text: `${head} Solicitud recibida. Número de confirmación: ${sb.confirmation}. Guarde este número. (Comprobante de prueba: no hay documento real.)`,
    fields: [],
    buttons: [],
    captcha: false,
  };
}

export function sandboxOpen(sb: SandboxState): PageView {
  if (sb.page === "done") return sandboxRead(sb);
  sb.page = sb.page === "start" ? "start" : sb.page;
  return sandboxRead(sb);
}

export function sandboxFill(sb: SandboxState, id: string, value: string): string {
  if (sb.page !== "form") return "not found";
  if (!formFields(sb).some((f) => f.id === id)) return "not found";
  sb.values[id] = value.slice(0, 200);
  return "ok";
}

export function sandboxClick(sb: SandboxState, id: string): string {
  if (sb.page === "start" && id === "b1") sb.page = "form";
  else if (sb.page === "form" && id === "b20") {
    if (formFields(sb).some((f) => !f.value)) return "the form says: complete all the fields";
    sb.page = "review";
  } else if (sb.page === "review" && id === "b21") sb.page = "form";
  else if (sb.page === "review" && id === "b22") sb.page = "pay";
  else if (sb.page === "pay" && id === "b31") {
    if (!sb.cardEntered) return "the page says: enter the card first";
    sb.confirmation = `PRUEBA-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    sb.page = "done";
  } else return "not found";
  return "ok";
}

// The customer typed the test card in the practice office's live view.
export function sandboxEnterCard(sb: SandboxState, card: string): boolean {
  const digits = card.replace(/\D/g, "");
  if (digits !== "4242424242424242") return false;
  sb.cardEntered = true; // the number itself is never stored
  return true;
}
