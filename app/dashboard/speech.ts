// Speech helpers shared by the chat microphone and the "dictate a reply"
// button. Phones are stricter than computers: the transcript has to be
// rebuilt from every result (Android repeats earlier ones), a manual stop
// may leave only "interim" text, and a refused microphone must say so
// instead of staying silent.

type Alt = { transcript: string };
type Res = ArrayLike<Alt> & { isFinal: boolean };
type Rec = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives?: number;
  start: () => void;
  stop: () => void;
  abort?: () => void;
  onresult: ((e: { results: ArrayLike<Res> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
};

export function canListen(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
}

export type ListenHandle = { stop: () => void };

// Starts listening. `onText` gets the whole transcript so far (as it grows),
// `onEnd` gets the final text (may be empty) and an error code, if any.
export function listenOnce(
  lang: "es" | "en",
  onText: (text: string) => void,
  onEnd: (text: string, error: string) => void
): ListenHandle | null {
  const W = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
  const R = W.SpeechRecognition || W.webkitSpeechRecognition;
  if (!R) return null;
  const rec = new R();
  rec.lang = lang === "es" ? "es-US" : "en-US";
  rec.interimResults = true;
  rec.continuous = false;
  let last = "";
  let error = "";
  let done = false;
  rec.onresult = (e) => {
    let text = "";
    for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
    last = text.replace(/\s+/g, " ").trim();
    onText(last);
  };
  const finish = () => {
    if (done) return;
    done = true;
    onEnd(last, error);
  };
  rec.onerror = (e) => {
    error = e?.error || "error";
    // "aborted" is us stopping; "no-speech" is silence: both end normally.
    if (error === "aborted") error = "";
  };
  rec.onend = finish;
  try {
    rec.start();
  } catch {
    onEnd("", "start");
    return null;
  }
  return {
    stop: () => {
      try {
        rec.stop();
      } catch {
        finish();
      }
      // Some phones never fire "end" after stop(): close it ourselves.
      setTimeout(finish, 1500);
    },
  };
}

export function listenError(code: string, lang: "es" | "en"): string {
  const es = lang === "es";
  if (code === "not-allowed" || code === "service-not-allowed")
    return es
      ? "El micrófono está bloqueado. Permítelo en los ajustes del navegador (el candado junto a la dirección) y vuelve a tocarlo."
      : "The microphone is blocked. Allow it in the browser settings (the lock next to the address) and tap it again.";
  if (code === "audio-capture") return es ? "No encuentro un micrófono en este dispositivo." : "I can't find a microphone on this device.";
  if (code === "network") return es ? "Sin conexión para escucharte. Revisa tu internet e inténtalo otra vez." : "No connection to listen. Check your internet and try again.";
  if (code === "no-speech") return es ? "No te escuché. Toca el micrófono y habla de nuevo." : "I didn't hear you. Tap the microphone and speak again.";
  return es ? "No pude escucharte. Inténtalo otra vez o escribe el mensaje." : "I couldn't hear you. Try again or type the message.";
}

// Reading aloud: the first call must happen inside a tap on phones, and long
// replies are read sentence by sentence (Android stops long utterances).
export function unlockSpeech() {
  try {
    if (!("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    window.speechSynthesis.speak(u);
  } catch {
    /* no speech on this device */
  }
}

export function speakText(text: string, lang: "es" | "en") {
  try {
    const parts = text.match(/[^.!?¿¡\n]+[.!?]*/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];
    for (const part of parts) {
      const u = new SpeechSynthesisUtterance(part);
      u.lang = lang === "es" ? "es-US" : "en-US";
      window.speechSynthesis.speak(u);
    }
  } catch {
    /* no speech on this device */
  }
}
