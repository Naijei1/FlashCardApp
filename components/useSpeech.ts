"use client";

import { neuralSpeechPath } from "@/lib/speech-request";

// Shared across every TTS button. A deck can render dozens of buttons, so voice
// discovery and the global `voiceschanged` listener must not live in each
// component instance.
let synthesis: SpeechSynthesis | null = null;
let voices: SpeechSynthesisVoice[] = [];
let currentUtterance: SpeechSynthesisUtterance | null = null;
let neuralAudio: HTMLAudioElement | null = null;
let turnId = 0;

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

function silenceNeural() {
  if (!neuralAudio) return;
  neuralAudio.onerror = null;
  neuralAudio.pause();
}

// Device speech. Used for English and whenever neural playback cannot start.
function speakWeb(text: string, lang: string) {
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

// Must be called from a user gesture on iOS Safari / Chrome and the installed PWA.
// Neural audio starts with play() in this turn; the file arrives after. A failed
// or rate-limited response falls back to device speech.
function speak(text: string, lang: string) {
  const turn = ++turnId;
  const path = neuralSpeechPath(text, lang);
  silenceNeural();
  getSynthesis()?.cancel();
  if (!path || typeof Audio === "undefined") {
    speakWeb(text, lang);
    return;
  }

  const audio = neuralAudio ?? (neuralAudio = new Audio());
  let fellBack = false;
  const fallback = () => {
    if (fellBack || turn !== turnId) return;
    fellBack = true;
    silenceNeural();
    audio.removeAttribute("src");
    speakWeb(text, lang);
  };
  audio.preload = "auto";
  audio.onerror = fallback;
  audio.src = path;
  const played = audio.play();
  if (played && typeof played.catch === "function") {
    void played.catch(fallback);
  }
}

const sharedSpeech = { speak };

/** Stable shared speech controller; it owns no per-button state or effects. */
export function useSpeech() {
  return sharedSpeech;
}
