"use client";

import { useCallback, useEffect, useState } from "react";

// Module-level so voices load once and the current utterance survives GC
// (browsers stop speech if the utterance object is collected).
let voices: SpeechSynthesisVoice[] = [];
let currentUtterance: SpeechSynthesisUtterance | null = null;

function loadVoices() {
  if (typeof speechSynthesis !== "undefined") {
    voices = speechSynthesis.getVoices();
  }
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

export function useSpeech() {
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    setSupported(true);
    loadVoices();
    speechSynthesis.addEventListener("voiceschanged", loadVoices);
    return () => speechSynthesis.removeEventListener("voiceschanged", loadVoices);
  }, []);

  // Must be called from a user gesture on iOS Safari / Chrome.
  const speak = useCallback((text: string, lang: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    try {
      speechSynthesis.cancel();
      loadVoices();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang;
      const voice = pickVoice(lang);
      if (voice) utterance.voice = voice;
      utterance.rate = 0.9;
      currentUtterance = utterance;
      void currentUtterance;
      speechSynthesis.speak(utterance);
    } catch {
      // Speech is best-effort; fail silently.
    }
  }, []);

  return { supported, speak };
}
