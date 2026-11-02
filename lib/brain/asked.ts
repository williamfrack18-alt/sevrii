// Mechanical memory of the interview: which questions were already asked, and
// which answers are already in the expediente. The model forgets in a long
// chat; this runs in code on every reply, so a question that was answered is
// never asked again and a data point that is missing is never skipped.

import { missingProfile, type BusinessPlan } from "../plan";

const fold = (x: string) => x.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// What each question is about → the profile field it is for. A question that
// matches none of these is not checked (the model may ask it).
export const TOPICS: Record<string, RegExp> = {
  direction: /(ya sabes|lo que (ya )?sabes|relacionad\w+ con lo que|algo nuevo|aprender algo|probar algo|something (new|tied)|what you (already )?know|learn something)/,
  workHistory: /(trabajos que has|qu[eé] sabes hacer|jobs you|what you know how)/,
  askedFor: /(te piden|piden que (los |les )?ayudes|people ask you)/,
  likes: /(qu[eé] te gusta|te gusta m[aa]s|disfrutas|prefieres trabajar con|what do you enjoy|you enjoy)/,
  notWant: /(odi(as|es)|detestas|no quieres volver|no volver[ií]as|nunca (quieres|m[aa]s)|never want|you hate|hate doing)/,
  workPlace: /(desde (tu )?casa|a domicilio|en persona|from home|in person)/,
  tools: /(qu[eé] (herramientas|equipo)|con qu[eé] cuentas|what (tools|equipment))/,
  hasVehicle: /(carro|veh[ií]culo|\bauto\b|\bcar\b|vehicle)/,
  hoursPerWeek: /(horas (a la |por )?semana|hours (a|per) week)/,
  startBudgetUsd: /(presupuesto|cu[aa]nto (dinero|puedes)|dinero (para|disponible)|budget|how much (money|can you))/,
  languages: /(idiomas?|languages?)/,
  city: /(qu[eé] ciudad|ciudad y estado|what city|city and state)/,
  currentPrice: /(cu[aa]nto cobras|what do you charge)/,
  howGetsClients: /(c[oó]mo consigues|c[oó]mo (te )?llegan (tus )?clientes|how do you get (your )?(customers|clients))/,
  typicalCustomer: /(qui[eé]nes? (es|son) tus? cliente|who (is|are) your (typical )?(customer|client))/,
  exampleJob: /([uú]ltimo trabajo|trabajo reciente|last job)/,
  differentiators: /(qu[eé] te hace diferente|what makes you different)/,
  yearsExperience: /(cu[aa]ntos a[nñ]os|how many years)/,
  costHoursPerJob: /(cu[aa]ntas horas (te )?(toma|lleva|tarda|dedicas)|how many hours (does|do))/,
  businessName: /(nombre (de tu|para tu) negocio|c[oó]mo se llama tu negocio|business name|nombres? (cortos?|que te gusta))/,
  zip: /(c[oó]digo postal|\bzip\b)/,
  radiusMiles: /(cu[aa]ntas millas|how many miles|qu[eé] tan lejos)/,
};

// Permits, insurance and licenses are asked at most once in a whole chat.
const PERMITS_RE = /(permiso|licencia|\bseguros?\b|insurance|licen[sc]e|permit)/;
const PERMITS = { test: (folded: string) => PERMITS_RE.test(folded.replace(/(estas?|est[aá]s?|seguro|segura) (segur[oa]|de que|que)\b/g, " ").replace(/\bsegur[oa] (de|que)\b/g, " ")) };

// "city and state" → "city"; "hoursPerWeek (a number…)" → "hoursPerWeek".
export const keyOf = (missingItem: string) => (missingItem.startsWith("city and state") ? "city" : missingItem.split(/[\s(]/)[0]);

export function questionSentences(text: string): string[] {
  return (text.match(/¿[^?]*\?|[^.!?¿\n]*\?/g) ?? []).map((x) => x.trim()).filter(Boolean);
}

function topicOf(question: string): string {
  const q = fold(question);
  for (const [k, re] of Object.entries(TOPICS)) if (re.test(q)) return k;
  return "";
}

// Topics of every question the Brain asked in the chat so far (oldest first).
export function askedTopics(history: { role: string; content: string }[]): { topic: string; turn: number }[] {
  const out: { topic: string; turn: number }[] = [];
  history.forEach((h, turn) => {
    if (h.role !== "assistant") return;
    for (const q of questionSentences(h.content)) {
      const t = topicOf(q);
      if (t) out.push({ topic: t, turn });
      if (PERMITS.test(fold(q))) out.push({ topic: "permits", turn });
    }
  });
  return out;
}

// Plain, kind questions for the fields of the interview, in two wordings: the
// first time, and (with options) when it was already asked.
const ASK: Record<string, { es: [string, string]; en: [string, string] }> = {
  direction: {
    es: ["¿Prefieres algo relacionado con lo que ya sabes hacer, o probar algo nuevo que aprendas rápido? Las dos opciones están bien.", "Para ubicarme mejor, dime cuál se parece más a ti: 1) algo que ya sabes hacer, aunque nunca lo hayas vendido, o 2) algo nuevo para ti. Si te da igual, dime «cualquiera»."],
    en: ["Would you rather do something tied to what you already know, or try something new you can learn fast? Both are fine.", "To place you better, which one sounds more like you: 1) something you already know how to do, even if you never sold it, or 2) something new to you? If either is fine, say \"either\"."],
  },
  workHistory: {
    es: ["¿Qué trabajos has tenido o qué sabes hacer bien, aunque no haya sido como negocio?", "Cuéntame con un ejemplo corto algo que sabes hacer: puede ser un trabajo que tuviste o algo que haces para tu familia o amistades."],
    en: ["What jobs have you had, or what are you good at, even if it wasn't a business?", "Give me one short example of something you know how to do: a past job, or something you do for family or friends."],
  },
  askedFor: {
    es: ["¿Con qué cosas te piden ayuda las demás personas?", "Piensa en lo último en lo que alguien te pidió ayuda o un favor. ¿Qué fue?"],
    en: ["What do other people usually ask you for help with?", "Think of the last time someone asked you for help or a favor. What was it?"],
  },
  likes: {
    es: ["¿Qué te gusta hacer o en qué te sientes bien trabajando? Si no sabes, te doy opciones.", "Te doy opciones por si ayuda: ¿te gusta más trabajar con personas, con tus manos, con la computadora o con el celular, o algo distinto?"],
    en: ["What do you enjoy doing, or what do you feel good working on? If you're not sure, I'll give you options.", "Some options in case it helps: do you prefer working with people, with your hands, on a computer, or on your phone, or something else?"],
  },
  notWant: {
    es: ["¿Hay algún trabajo o tarea que odies o que no quieras volver a hacer nunca? Si no hay, dime «nada en especial».", "Para no proponerte nada que no quieras: ¿qué trabajo o tarea no volverías a hacer? Si ninguno, dime «nada en especial»."],
    en: ["Is there any job or task you hate or never want to do again? If not, say \"nothing in particular\".", "So I never suggest anything you don't want: which job or task would you not do again? If none, say \"nothing in particular\"."],
  },
  workPlace: {
    es: ["¿Prefieres trabajar desde casa con computadora o celular, salir a atender personas en persona, o te da igual?", "Elige una: 1) desde casa, 2) en persona con clientes, 3) cualquiera de las dos."],
    en: ["Would you rather work from home with a computer or phone, go out and serve people in person, or either?", "Pick one: 1) from home, 2) in person with customers, 3) either."],
  },
  tools: {
    es: ["¿Con qué cuentas hoy para empezar? Por ejemplo computadora, celular, carro o herramientas.", "Dime solo lo que tienes ahora, aunque sea poco: ¿computadora, celular, carro, herramientas…?"],
    en: ["What do you have today to start with? For example a computer, phone, car or tools.", "Just tell me what you have right now, even if it's little: computer, phone, car, tools…?"],
  },
  hasVehicle: {
    es: ["¿Tienes carro o algún vehículo para moverte?", "Solo sí o no: ¿tienes carro o vehículo para moverte a trabajar?"],
    en: ["Do you have a car or vehicle to get around?", "Just yes or no: do you have a car or vehicle to get to work?"],
  },
  hoursPerWeek: {
    es: ["¿Cuántas horas a la semana podrías dedicarle? Dime un número aproximado.", "Dime un número aproximado de horas por semana, por ejemplo 10, 20 o 30. Si no lo tienes claro, dime cuál te parece posible."],
    en: ["How many hours a week could you give it? Give me an approximate number.", "Give me an approximate number of hours per week, for example 10, 20 or 30. If you're not sure, tell me which seems possible."],
  },
  startBudgetUsd: {
    es: ["¿Cuánto dinero tienes disponible para empezar? Si es cero, dímelo, también sirve.", "Dime una cifra en dólares con lo que podrías invertir al inicio. Cero también es una respuesta válida."],
    en: ["How much money do you have available to start? If it's zero, say so, that works too.", "Give me a dollar amount you could put in at the start. Zero is also a valid answer."],
  },
  languages: {
    es: ["¿Atenderías en español, en inglés o en los dos idiomas?", "Elige una: 1) solo español, 2) solo inglés, 3) los dos."],
    en: ["Would you serve customers in Spanish, English or both?", "Pick one: 1) Spanish only, 2) English only, 3) both."],
  },
  exampleJob: {
    es: ["¿Cuál fue el último trabajo que hiciste? Cuéntamelo en una o dos frases.", "Dame un ejemplo real y reciente de un trabajo tuyo: qué hiciste y para quién, aunque sea corto."],
    en: ["What was the last job you did? Tell me in a sentence or two.", "Give me a real, recent example of your work: what you did and for whom, even if short."],
  },
  typicalCustomer: {
    es: ["¿Quiénes suelen ser tus clientes?", "Piensa en tus últimos clientes: ¿qué tienen en común (edad, tipo de negocio, zona)?"],
    en: ["Who are your typical customers?", "Think of your last few customers: what do they have in common (age, type of business, area)?"],
  },
  howGetsClients: {
    es: ["¿Cómo consigues clientes hoy?", "¿Cómo te encontró el último cliente: por recomendación, redes sociales, un anuncio u otra forma?"],
    en: ["How do you get customers today?", "How did your last customer find you: a referral, social media, an ad or something else?"],
  },
  currentPrice: {
    es: ["¿Cuánto cobras hoy por tu servicio? Dime el precio y por qué unidad (por visita, por hora, por mes…).", "Dime un precio real que hayas cobrado y por qué: por ejemplo «$50 por visita»."],
    en: ["What do you charge today for your service? Give me the price and the unit (per visit, per hour, per month…).", "Give me a real price you've charged and for what: for example \"$50 per visit\"."],
  },
  differentiators: {
    es: ["¿Qué te hace diferente de otras personas que hacen lo mismo?", "Si un cliente te eligió a ti y no a otra persona, ¿por qué crees que fue?"],
    en: ["What makes you different from others who do the same work?", "If a customer picked you over someone else, why do you think it was?"],
  },
  serviceMode: {
    es: ["¿Atiendes a tus clientes en persona, en una zona, o por internet desde donde estés?", "Elige una: 1) en persona, en una zona o ciudad, 2) por internet, sin importar dónde viva el cliente."],
    en: ["Do you serve customers in person, in an area, or online from wherever you are?", "Pick one: 1) in person, in a city or area, 2) online, wherever the customer lives."],
  },
  zip: {
    es: ["¿Cuál es tu código postal de 5 dígitos? Lo uso para ubicarte en el mapa.", "Solo los 5 números de tu código postal (ZIP), por ejemplo 33101."],
    en: ["What is your 5-digit ZIP code? I use it to place you on the map.", "Just the 5 digits of your ZIP code, for example 33101."],
  },
  radiusMiles: {
    es: ["¿Hasta cuántas millas te mueves para atender a un cliente? Dime un número.", "Dime un número aproximado de millas desde tu ciudad, por ejemplo 10, 20 o 30."],
    en: ["How many miles will you travel to serve a customer? Give me a number.", "Give me an approximate number of miles from your city, for example 10, 20 or 30."],
  },
  city: {
    es: ["¿En qué ciudad y estado vives?", "Dime la ciudad y el estado donde vives, por ejemplo «Miami, FL»."],
    en: ["What city and state do you live in?", "Tell me the city and state where you live, for example \"Miami, FL\"."],
  },
};

// The next thing to ask, in code: for the first missing field of the interview.
export function nextQuestion(plan: BusinessPlan, lang: "es" | "en", history: { role: string; content: string }[]): string {
  const key = keyOf(missingProfile(plan)[0] ?? "");
  const ask = ASK[key];
  if (!ask) return "";
  const times = askedTopics(history).filter((a) => a.topic === key).length;
  return ask[lang][times > 0 ? 1 : 0];
}

// Is this field really filled in the profile? (A field that is just not part of
// this interview is not "answered": a question about it is left alone.)
function filled(plan: BusinessPlan, key: string): boolean {
  const v = (plan.profile as unknown as Record<string, unknown>)[key];
  if (key === "city") return Boolean(plan.profile.city && plan.profile.state);
  return v !== "" && v !== null && v !== undefined;
}

export type Dedupe = {
  reply: string;
  // Questions taken out because their answer is already saved (or they were asked before).
  dropped: string[];
  // The reply asks again for what the last message already asked and is still missing.
  repeated: string;
  // That question as written, and whether it is (nearly) the same words as before.
  repeatedQuestion: string;
  sameWords: boolean;
};

const bag = (t: string) => new Set(fold(t).split(/[^a-z0-9]+/).filter((w) => w.length >= 3));
export function similar(a: string, b: string): number {
  const x = bag(a);
  const y = bag(b);
  if (!x.size || !y.size) return 0;
  let n = 0;
  for (const w of x) if (y.has(w)) n++;
  return n / (x.size + y.size - n);
}

// A reply never asks what is already in the expediente or what the last message
// already asked: that question is taken out, and code decides what comes next.
export function dedupeReply(reply: string, plan: BusinessPlan, history: { role: string; content: string }[]): Dedupe {
  const out: Dedupe = { reply, dropped: [], repeated: "", repeatedQuestion: "", sameWords: false };
  const interview = plan.stage === "interview" || plan.stage === "ready_check";
  const missing = interview ? missingProfile(plan).map(keyOf) : [];
  const asked = askedTopics(history);
  const lastAssistantTurn = Math.max(-1, ...history.map((h, i) => (h.role === "assistant" ? i : -1)));
  let text = reply;
  for (const q of questionSentences(reply)) {
    const folded = fold(q);
    // Permits, insurance, license: only once in the whole conversation.
    if (PERMITS.test(folded) && asked.some((a) => a.topic === "permits")) {
      text = text.replace(q, "");
      out.dropped.push("permits");
      continue;
    }
    if (!interview) continue;
    const t = topicOf(q);
    if (!t) continue;
    if (!missing.includes(t)) {
      // Already answered (or not part of this interview): don't ask it. (In the
      // readiness check the model may ask about the chosen idea with the same words.)
      if (plan.stage !== "interview" || !filled(plan, t)) continue;
      text = text.replace(q, "");
      out.dropped.push(t);
    } else if (t === missing[0] && asked.some((a) => a.topic === t && a.turn === lastAssistantTurn)) {
      out.repeated = t;
      out.repeatedQuestion = q;
      const before = [...history].reverse().find((h) => h.role === "assistant")?.content ?? "";
      out.sameWords = questionSentences(before).some((b) => topicOf(b) === t && similar(b, q) >= 0.5);
    }
  }
  out.reply = text.replace(/\s{2,}/g, " ").replace(/\s+([.,!?])/g, "$1").trim();
  return out;
}

// What the owner already told us and what was already asked, one line each, to
// re-inject on every turn (the chat history is long; this is short).
export function lockedFacts(plan: BusinessPlan, history: { role: string; content: string }[]): string {
  const p = plan.profile;
  const bits: string[] = [];
  const add = (label: string, v: unknown) => {
    if (v !== "" && v !== null && v !== undefined) bits.push(`${label}: ${v}`);
  };
  add("servicio", p.mainService || plan.service);
  add("ciudad", [p.city, p.state].filter(Boolean).join(", "));
  add("modelo del servicio", p.workLocation);
  add("precio que cobra hoy", p.currentPrice);
  add("horas por trabajo", p.costHoursPerJob);
  add("horas por semana", p.hoursPerWeek);
  add("costo de materiales", p.costMaterialsUsd);
  add("presupuesto inicial", p.startBudgetUsd);
  add("le gusta", p.likes);
  add("NUNCA quiere (filtro duro)", p.notWant);
  if (plan.packages.length) bits.push(`paquetes y precios bloqueados: ${plan.packages.map((k) => `${k.name} ${k.price}`).join("; ")}`);
  bits.push(`oferta: ${p.offerWanted ? p.offerWanted : "Sin oferta (la persona no pidió descuento)"}`);
  const topics = [...new Set(askedTopics(history).map((a) => a.topic))];
  const done = Object.keys(TOPICS).filter((k) => !(plan.stage === "interview" || plan.stage === "ready_check" ? missingProfile(plan).map(keyOf) : []).includes(k) && topics.includes(k));
  return `Datos ya confirmados (no los cambies sin permiso): ${bits.join(" | ")}.${done.length ? ` Ya contestadas, no las vuelvas a preguntar: ${done.join(", ")}.` : ""}`;
}
