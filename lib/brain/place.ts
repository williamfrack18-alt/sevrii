// Where the person is, deduced in code (the model is told to do it too, but
// it forgets): "Medellín" → CO, "Madrid, España" → ES, "Lima" → PE,
// "Miami, FL" → US. Sevrii works in any country, so a city that also exists
// as a small US town ("Madrid, Iowa", "Lima, Ohio") is never sent to the US
// unless the person said a US state or the US. Pure: no database, no AI.

import type { Profile } from "../plan";

const fold = (x: string) => x.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Countries people name, in Spanish and English (built from the ISO codes).
const CODES = (
  "US MX CO ES AR PE CL VE EC BO PY UY DO GT SV HN NI CR PA CU PR CA BR GB IE PT FR DE IT NL BE CH AT AU NZ " +
  "SE NO DK FI PL GR MA JP KR CN IN PH IL AE ZA NG KE"
).split(" ");
const ALIASES: Record<string, string> = {
  "ee uu": "US", eeuu: "US", "ee uu a": "US", usa: "US", "u s a": "US", "u s": "US", "estados unidos": "US", "united states": "US",
  uk: "GB", "reino unido": "GB", inglaterra: "GB", england: "GB", escocia: "GB", scotland: "GB", "gran bretana": "GB", britain: "GB",
  "republica dominicana": "DO", "rep dominicana": "DO", "dominican republic": "DO", rd: "DO",
  mejico: "MX", "puerto rico": "PR", holanda: "NL", "paises bajos": "NL", suiza: "CH",
};
let NAMES: [string, string][] | null = null;
function countryNames(): [string, string][] {
  if (NAMES) return NAMES;
  const out = new Map<string, string>(Object.entries(ALIASES));
  for (const loc of ["es", "en"]) {
    try {
      const dn = new Intl.DisplayNames([loc], { type: "region" });
      for (const c of CODES) {
        const n = dn.of(c);
        if (n && n !== c) out.set(fold(n), c);
      }
    } catch {
      // no Intl names: the aliases still work
    }
  }
  // Longest first: "republica dominicana" before "dominica".
  NAMES = [...out.entries()].sort((a, b) => b[0].length - a[0].length);
  return NAMES;
}

// Country names that are also everyday words ("salsa de chile", "una china").
const COMMON_WORDS = new Set(["chile", "china", "cuba", "india", "jordan", "turkey"]);
// A country the text names ("vivo en Lima, Perú" → PE), or "". `loose`: a
// whole message, where "chile" is more often food than a country.
export function countryNamedIn(text: string, loose = false): string {
  // "Nuevo México" / "New Mexico" is a US state, not Mexico.
  const t = ` ${fold(text).replace(/\b(nuevo|new) mexico\b/g, "new mex state")} `;
  if (!t.trim()) return "";
  if (/ new mex state /.test(t)) return "US";
  for (const [name, code] of countryNames()) if (t.includes(` ${name} `) && !(loose && COMMON_WORDS.has(name))) return code;
  return "";
}

// Big cities outside the US whose name alone says the country. Names shared
// with a big US city (San José, Santa Cruz, Dublin, Melbourne…) are left out.
const CITIES: Record<string, string> = {
  medellin: "CO", bogota: "CO", cali: "CO", barranquilla: "CO", cartagena: "CO", bucaramanga: "CO", pereira: "CO", manizales: "CO", "santa marta": "CO", cucuta: "CO", ibague: "CO", envigado: "CO",
  madrid: "ES", barcelona: "ES", sevilla: "ES", malaga: "ES", bilbao: "ES", zaragoza: "ES", alicante: "ES", murcia: "ES", "palma de mallorca": "ES", "las palmas": "ES", granada: "ES", vigo: "ES", gijon: "ES", "santiago de compostela": "ES",
  "ciudad de mexico": "MX", cdmx: "MX", "mexico df": "MX", "df": "MX", guadalajara: "MX", monterrey: "MX", puebla: "MX", tijuana: "MX", cancun: "MX", queretaro: "MX", merida: "MX", leon: "MX", toluca: "MX", "san luis potosi": "MX", aguascalientes: "MX", chihuahua: "MX", hermosillo: "MX", culiacan: "MX", morelia: "MX", oaxaca: "MX", veracruz: "MX", acapulco: "MX", "ciudad juarez": "MX",
  lima: "PE", arequipa: "PE", cusco: "PE", cuzco: "PE", trujillo: "PE", chiclayo: "PE", piura: "PE",
  "buenos aires": "AR", rosario: "AR", mendoza: "AR", "mar del plata": "AR", "la plata": "AR", tucuman: "AR", salta: "AR",
  santiago: "CL", "santiago de chile": "CL", valparaiso: "CL", "vina del mar": "CL", concepcion: "CL", antofagasta: "CL",
  quito: "EC", guayaquil: "EC", caracas: "VE", maracaibo: "VE", barquisimeto: "VE",
  "santo domingo": "DO", "santiago de los caballeros": "DO", "punta cana": "DO",
  "ciudad de guatemala": "GT", "guatemala city": "GT", "san salvador": "SV", tegucigalpa: "HN", "san pedro sula": "HN", managua: "NI",
  "ciudad de panama": "PA", "panama city": "PA", asuncion: "PY", montevideo: "UY", "la habana": "CU", havana: "CU", "la paz": "BO", cochabamba: "BO",
  toronto: "CA", vancouver: "CA", montreal: "CA", calgary: "CA", ottawa: "CA", edmonton: "CA", winnipeg: "CA", mississauga: "CA", quebec: "CA", "quebec city": "CA", hamilton: "CA",
  londres: "GB", london: "GB", liverpool: "GB", edimburgo: "GB", edinburgh: "GB", glasgow: "GB",
  paris: "FR", lyon: "FR", marsella: "FR", berlin: "DE", munich: "DE", hamburgo: "DE", roma: "IT", rome: "IT", milan: "IT", lisboa: "PT", lisbon: "PT", oporto: "PT", porto: "PT", amsterdam: "NL",
  "sao paulo": "BR", "rio de janeiro": "BR", sydney: "AU",
};
// US state names and codes, to tell "Paris, TX" (US) from "París" (France).
const US_STATE_RE =
  /(^|[\s,(])(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)(?=$|[\s,).])/;
const US_STATE_NAMES = /\b(alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming)\b/;

// "Medellín" → CO; "Madrid" → ES; "Toronto, Ontario" → CA; "" when unknown.
export function countryOfCity(city: string): string {
  const head = fold(city.split(",")[0] ?? "");
  if (CITIES[head] ?? CITIES[fold(city)]) return CITIES[head] ?? CITIES[fold(city)];
  // "Bogotá DC", "Medellín Antioquia": the longest known city at the start.
  const words = head.split(" ");
  for (let n = words.length - 1; n >= 1; n--) {
    const hit = CITIES[words.slice(0, n).join(" ")];
    if (hit) return hit;
  }
  return "";
}

// Does the text name a US state ("Miami, FL", "Houston Texas")? `except`: an
// ISO country code that is also a state code ("Medellín, CO" is Colombia,
// "Toronto, CA" is Canada), not counted as a state.
export function namesUsState(text: string, except = ""): boolean {
  const code = US_STATE_RE.exec(text)?.[2] ?? "";
  // ("Bogotá DC" is Colombia's capital district.)
  return (Boolean(code) && code !== except && !(except === "CO" && code === "DC")) || US_STATE_NAMES.test(fold(text));
}

// The country of a place as typed ("Medellín, Colombia", "Madrid", "Miami, FL").
export function countryOfPlace(text: string): string {
  const named = countryNamedIn(text);
  if (named) return named;
  const guess = countryOfCity(text);
  return guess && !namesUsState(text, guess) ? guess : namesUsState(text) ? "US" : guess;
}

// After the profile changes: fill in the country the person's words make
// obvious, and keep US-only fields (state, ZIP) out of other countries.
// `countryGiven`: the model sent a country this turn (it wins over a city
// guess, never over what the person wrote). `said`: the person's message.
export function settlePlace(p: Profile, said = "", countryGiven = false): Profile {
  let country = p.country;
  if (p.city) {
    const saidHere = said && fold(said).includes(fold(p.city.split(",")[0] ?? "")) ? countryNamedIn(said, true) : "";
    const named = countryNamedIn(`${p.city}, ${p.region}`) || saidHere;
    if (named) country = named;
    else if (!countryGiven) {
      // A country that only came from a "state" code ("CO" for Colombia is
      // also Colorado) gives way to a city that clearly is elsewhere.
      const guess = countryOfCity(p.city);
      if (guess && (!country || (country === "US" && !namesUsState(`${p.city}, ${said}`, guess)))) country = guess;
    }
  } else if (!country && said) {
    // Online, no city: "trabajo en línea desde Colombia".
    country = countryNamedIn(said, true);
  }
  if (country && country !== "US" && country !== "PR") return { ...p, country, state: "", zip: "" };
  return { ...p, country };
}
