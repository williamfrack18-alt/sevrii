// Sensitive data never stays in the chat: if a customer types a card number,
// a Social Security number or a password in the message box, it's removed
// before the message is saved or read by the AI, and the customer is told to
// type it only in the official page when the agent asks.

function luhn(d: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = d.charCodeAt(i) - 48;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

const CARD = /\b(?:\d[ -]?){13,19}\b/g;
const SSN = /\b\d{3}[- ]\d{2}[- ]\d{4}\b/g;
const CVV = /\b(cvv|cvc|c[oó]digo de seguridad|security code)\s*[:=]?\s*\d{3,4}\b/gi;
const PASSWORD = /\b(contrase[nñ]a|clave|password|passcode|pin)\b(\s*(es|is|:|=)\s*)(\S+)/gi;

export function redactSensitive(text: string): { text: string; found: boolean } {
  let found = false;
  let out = text.replace(CARD, (m) => {
    const d = m.replace(/\D/g, "");
    if (d.length >= 13 && d.length <= 19 && luhn(d)) {
      found = true;
      return `[tarjeta eliminada]${/[ -]$/.test(m) ? " " : ""}`;
    }
    return m;
  });
  out = out.replace(SSN, () => {
    found = true;
    return "[número eliminado]";
  });
  out = out.replace(CVV, (_m, k: string) => {
    found = true;
    return `${k} [eliminado]`;
  });
  out = out.replace(PASSWORD, (_m, k: string, sep: string) => {
    found = true;
    return `${k}${sep}[eliminada]`;
  });
  return { text: out, found };
}
