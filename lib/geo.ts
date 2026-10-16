// US places for "where does this business work / where is this customer".
// Data: lib/geo/us-geo.json — cities (name, state, lat, lon, #zips) and ZIP →
// city, from the zipcodes npm package (BSD license, see lib/geo/LICENSE-zipcodes).
// Server only (the file is ~1.4 MB).
import "server-only";
import data from "./geo/us-geo.json";

export type Place = { city: string; state: string; lat: number; lon: number };

type Raw = { c: [string, string, number, number, number][]; z: string };
const RAW = data as unknown as Raw;

let zipIndex: Map<string, { city: number; lat: number; lon: number }> | null = null;
let cityIndex: Map<string, number[]> | null = null;

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\bst\.?\s/g, "saint ")
    .replace(/\bft\.?\s/g, "fort ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function indexes() {
  if (!zipIndex || !cityIndex) {
    zipIndex = new Map();
    for (const part of RAW.z.split(",")) {
      const [zip, idx, lat, lon] = part.split(":");
      zipIndex.set(zip, { city: parseInt(idx, 36), lat: parseInt(lat, 36) / 100, lon: parseInt(lon, 36) / 100 });
    }
    cityIndex = new Map();
    RAW.c.forEach((c, i) => {
      const k = norm(c[0]);
      const list = cityIndex!.get(k);
      if (list) list.push(i);
      else cityIndex!.set(k, [i]);
    });
  }
  return { zipIndex, cityIndex };
}

const place = (i: number): Place => {
  const c = RAW.c[i];
  return { city: c[0], state: c[1], lat: c[2], lon: c[3] };
};

export const US_STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", PR: "Puerto Rico", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas",
  UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};
const STATE_BY_NAME = new Map(Object.entries(US_STATES).map(([code, name]) => [norm(name), code]));

function stateCode(s: string): string | null {
  const t = s.trim();
  if (/^[A-Za-z]{2}$/.test(t) && US_STATES[t.toUpperCase()]) return t.toUpperCase();
  return STATE_BY_NAME.get(norm(t)) ?? null;
}

// "33101", "Miami, FL", "Miami FL", "Miami, Florida", "Miami" → a place (or null).
export function lookupPlace(input: string, preferState?: string): Place | null {
  const q = (input || "").trim().slice(0, 80);
  if (!q) return null;
  const { zipIndex, cityIndex } = indexes();
  const zip = /\b(\d{5})(?:-\d{4})?\b/.exec(q);
  if (zip && zipIndex.has(zip[1])) {
    // The ZIP's own spot (more precise than the city center), named after its city.
    const z = zipIndex.get(zip[1])!;
    return { ...place(z.city), lat: z.lat, lon: z.lon };
  }

  let cityPart = q;
  let state: string | null = null;
  const comma = q.split(",").map((x) => x.trim()).filter(Boolean);
  if (comma.length >= 2) {
    state = stateCode(comma[comma.length - 1]);
    cityPart = comma[0];
  }
  if (!state) {
    // "Miami FL" / "San Antonio Texas"
    const words = q.replace(/,/g, " ").trim().split(/\s+/);
    for (let n = Math.min(2, words.length - 1); n >= 1; n--) {
      const code = stateCode(words.slice(-n).join(" "));
      if (code) {
        state = code;
        cityPart = words.slice(0, -n).join(" ");
        break;
      }
    }
  }
  const hits = cityIndex.get(norm(cityPart));
  if (!hits?.length) return null;
  const want = state || (preferState ? stateCode(preferState) : null);
  const pick = want ? hits.find((i) => RAW.c[i][1] === want) : hits[0]; // hits are biggest first
  return pick === undefined ? (state ? null : place(hits[0])) : place(pick);
}

export function milesBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 3958.8;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// The nearest known city to a point (for "you're in …" labels from IP coordinates).
export function nearestPlace(lat: number, lon: number): Place | null {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < RAW.c.length; i++) {
    const c = RAW.c[i];
    if (c[4] < 2) continue; // tiny or special-purpose places make bad labels
    const d = (c[2] - lat) ** 2 + ((c[3] - lon) * Math.cos((lat * Math.PI) / 180)) ** 2;
    // Prefer bigger cities when they're about as close.
    const score = d / (1 + Math.log(c[4]) * 0.15);
    if (score < bestD) {
      bestD = score;
      best = i;
    }
  }
  return best >= 0 ? place(best) : null;
}
