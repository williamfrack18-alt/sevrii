"use client";

// The look shared by Sevrii's chats (Brain, Store, Agent, Marketing) and the
// Brain's question cards: Sevrii's mark beside the assistant and a soft sound
// when it says something new.

// Sevrii's mark beside the assistant: still, or turning while it thinks or writes.
export function Mark({ size = 24, live = false }: { size?: number; live?: boolean }) {
  return live ? (
    <span className="sevrii-loader chat-mark-live" style={{ width: size, height: size }} aria-hidden="true">
      <span className="sevrii-loader-ring" />
      <span className="sevrii-loader-logo" />
    </span>
  ) : (
    <span className="chat-mark" style={{ width: size, height: size }} aria-hidden="true" />
  );
}

// A soft two-note sound when a reply arrives (Web Audio, no file). The
// browser only plays it after the person has interacted (sending primes it).
let audioCtx: AudioContext | null = null;
export function primeChime() {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    audioCtx ??= new AC();
    if (audioCtx.state === "suspended") void audioCtx.resume();
  } catch {
    // No sound is fine.
  }
}
export function chime() {
  const ctx = audioCtx;
  if (!ctx || ctx.state !== "running") return;
  try {
    const now = ctx.currentTime;
    for (const [freq, at] of [
      [659.25, 0],
      [987.77, 0.1],
    ]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + at);
      gain.gain.exponentialRampToValueAtTime(0.06, now + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.5);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + at);
      osc.stop(now + at + 0.55);
    }
  } catch {
    // No sound is fine.
  }
}
