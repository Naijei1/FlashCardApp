"use client";

import { useSpeech } from "./useSpeech";

export default function TtsButton({
  text,
  lang,
  className = "",
}: {
  text: string;
  lang: string;
  className?: string;
}) {
  const { supported, speak } = useSpeech();
  if (!supported) return null;
  return (
    <button
      type="button"
      aria-label={`Pronounce ${text}`}
      onClick={(e) => {
        e.stopPropagation();
        speak(text, lang);
      }}
      className={`inline-flex h-11 w-11 items-center justify-center rounded-full text-xl text-muted hover:bg-border/40 hover:text-foreground ${className}`}
    >
      🔊
    </button>
  );
}
