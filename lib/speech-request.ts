/** Pinned voice. The route rejects anything else so this process is not an open TTS proxy. */
export const NEURAL_VOICE = "zh-CN-XiaoxiaoNeural";
/** SSML rate matching the Web Speech fallback (`utterance.rate = 0.9`). */
export const NEURAL_RATE = "-10%";
/** Short flashcard heads only. Longer lines stay on device speech. */
export const MAX_NEURAL_CHARS = 80;

function hasIdeograph(text: string): boolean {
  try {
    return /\p{Unified_Ideograph}/u.test(text);
  } catch {
    return /[\u3400-\u9fff]/.test(text);
  }
}

/**
 * Same-origin URL for neural audio, or null when Web Speech should speak.
 * The browser sets `audio.src` to this URL and calls `play()` inside the tap.
 */
export function neuralSpeechPath(text: string, lang: string): string | null {
  if (!lang.replace("_", "-").toLowerCase().startsWith("zh")) return null;
  const trimmed = text.normalize("NFC").trim();
  if (!trimmed || [...trimmed].length > MAX_NEURAL_CHARS) return null;
  if (!hasIdeograph(trimmed)) return null;
  return `/api/speech?text=${encodeURIComponent(trimmed)}`;
}

/** Text the speech route will synthesize, or null when the query is out of scope. */
export function acceptedSpeechText(text: string): string | null {
  const trimmed = text.normalize("NFC").trim();
  if (!trimmed || [...trimmed].length > MAX_NEURAL_CHARS) return null;
  if (!hasIdeograph(trimmed)) return null;
  return trimmed;
}
