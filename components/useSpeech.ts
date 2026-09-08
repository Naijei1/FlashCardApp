"use client";

// Shared across every TTS button. A deck can render dozens of buttons, so voice
// discovery and the global `voiceschanged` listener must not live in each
// component instance.
let synthesis: SpeechSynthesis | null = null;
let voices: SpeechSynthesisVoice[] = [];
let currentUtterance: SpeechSynthesisUtterance | null = null;

function loadVoices() {
  voices = synthesis?.getVoices() ?? [];
}

function getSynthesis(): SpeechSynthesis | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;

  if (!synthesis) {
    synthesis = window.speechSynthesis;
    loadVoices();
    synthesis.addEventListener("voiceschanged", loadVoices);
  }
  return synthesis;
}

function normalizeLang(lang: string): string {
  return lang.replace("_", "-").toLowerCase();
}

function pickVoice(lang: string): SpeechSynthesisVoice | undefined {
  const target = normalizeLang(lang);
  const base = target.split("-")[0];
  return (
    voices.find((v) => normalizeLang(v.lang) === target && v.localService) ??
    voices.find((v) => normalizeLang(v.lang) === target) ??
    voices.find((v) => normalizeLang(v.lang).startsWith(base))
  );
}

// Must be called from a user gesture on iOS Safari / Chrome.
function speak(text: string, lang: string) {
  const activeSynthesis = getSynthesis();
  if (!activeSynthesis) return;

  try {
    activeSynthesis.cancel();
    loadVoices();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    const voice = pickVoice(lang);
    if (voice) utterance.voice = voice;
    utterance.rate = 0.9;
    currentUtterance = utterance;
    void currentUtterance;
    activeSynthesis.speak(utterance);
  } catch {
    // Speech is best-effort; fail silently.
  }
}

const sharedSpeech = { speak };

/** Stable shared speech controller; it owns no per-button state or effects. */
export function useSpeech() {
  return sharedSpeech;
}
