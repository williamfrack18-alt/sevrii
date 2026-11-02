// What may reach the store page from the approved strategy. Pure (no
// database, no AI): the Brain uses it when the owner confirms, and the page
// builder uses it again, so internal reasoning ("te conviene porque…",
// "lo elegí porque…") never shows up on a customer's screen.

// Phrases that explain WHY Sevrii chose something for the owner: they are
// for the owner in the Brain, never for customers.
const WHY =
  /\b(te conviene|le conviene|les conviene|conviene porque|te sirve porque|lo eleg[ií]|la eleg[ií]|los eleg[ií]|elegimos|escogimos|te lo propongo porque|recomendad[oa]s? porque|por tu experiencia|con tu experiencia|seg[uú]n tu perfil|encaja contigo|encaja con (tu|lo que)|aprovecha(ndo)? (tu|lo que sabes)|ya que (sabes|tienes|vives|te gusta)|porque (sabes|tienes|vives|te gusta|ya haces|tu experiencia|tu zona|tu ciudad)|fits you|suits you|because you (know|have|live|like)|given your|based on your (profile|experience)|we chose|i chose)\b/i;

const SENT = /(?<=[.!?])\s+/;

// A text without its reasoning: a list item keeps only its part before the
// explanation ("Arreglo de suelas — te conviene porque…" → "Arreglo de suelas"),
// a sentence that only explains the choice goes.
export function stripReasoning(text: string): string {
  if (!text || !WHY.test(text)) return text;
  const items = text.split(/\s*;\s*/).filter(Boolean);
  const cleanItem = (item: string) => {
    if (!WHY.test(item)) return item;
    // "Servicio — razón", "Servicio: razón", "Servicio (razón)", "Servicio, porque…"
    const head = item.split(/\s+[—–-]\s+|:\s+|\s*\(|,\s+(?=(porque|ya que|pues|because|since)\b)/i)[0]?.trim() ?? "";
    if (head && head !== item && !WHY.test(head)) return head.replace(/[.,;:]+$/, "");
    return item
      .split(SENT)
      .filter((x) => !WHY.test(x))
      .join(" ")
      .trim();
  };
  const sep = /;/.test(text) ? "; " : " ";
  return items.map(cleanItem).filter(Boolean).join(sep).trim();
}

export function hasReasoning(text: string): boolean {
  return WHY.test(text || "");
}
