"use client";

import { useCallback, useState } from "react";
import { DEFAULT_BACK_LANG, DEFAULT_FRONT_LANG } from "@/lib/languages";
import HardWordButton from "./HardWordButton";
import RatingBar from "./RatingBar";
import { QueueStatus, SessionHeader } from "./SessionChrome";
import TtsButton from "./TtsButton";
import { useKeyboard } from "./useKeyboard";
import { useStudyQueue } from "./useStudyQueue";

type DeckLangs = Record<string, { front?: string; back?: string }>;

export default function ReviewSession({
  deckId,
  deckLangs,
  backHref,
  newOnly = false,
}: {
  deckId: string;
  deckLangs: DeckLangs;
  backHref: string;
  newOnly?: boolean;
}) {
  const study = useStudyQueue({ deckId, mode: "review", newOnly });
  const [revealed, setRevealed] = useState(false);
  const [showEnglish, setShowEnglish] = useState(false);
  const { current, submitRating } = study;

  const reveal = useCallback(() => {
    if (current) setRevealed(true);
  }, [current]);

  const rate = useCallback((rating: number) => {
    if (!revealed || !submitRating(rating)) return;
    setRevealed(false);
    setShowEnglish(false);
  }, [revealed, submitRating]);

  useKeyboard((event) => {
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      if (revealed) rate(3);
      else reveal();
    } else if (revealed && ["1", "2", "3", "4"].includes(event.key)) {
      event.preventDefault();
      rate(Number(event.key));
    }
  });

  const status = (
    <QueueStatus study={study} backHref={backHref} copy={{
      noun: "review",
      verb: "reviewed",
      empty: newOnly
        ? "No unseen words are waiting here. Use Spaced Repetition for words you have already started."
        : "No cards are due right now — come back later.",
    }} />
  );
  if (!current) return status;

  const { card, pinyin } = current;
  const frontLang = pinyin ? "zh-CN" : deckLangs[card.deckId]?.front || DEFAULT_FRONT_LANG;
  const backLang = deckLangs[card.deckId]?.back || DEFAULT_BACK_LANG;
  const prompt = pinyin?.hanzi ?? card.front;

  return (
    <div className="study-surface mx-auto flex h-dvh w-full max-w-2xl flex-col px-4 pb-safe">
      <SessionHeader backHref={backHref} study={study} action={
        <HardWordButton key={`${card.deckId}:${card.id}`} card={card} onChange={(hard) => study.setHard(card, hard)} />
      } />

      {/* Tap anywhere on the card to reveal; two fixed halves so nothing jumps. */}
      <div onClick={reveal} className="flashcard flex min-h-0 flex-1 cursor-pointer flex-col overflow-hidden">
        <div className="flex min-h-0 flex-1 basis-1/2 flex-col items-center justify-center gap-3 overflow-y-auto px-6 py-6 text-center">
          <div className="flex items-center gap-2">
            <span lang={frontLang} className="selectable text-5xl leading-tight font-medium break-words sm:text-6xl">
              {prompt}
            </span>
            <TtsButton text={prompt} lang={frontLang} />
          </div>
          {pinyin && (
            <div className="flex flex-col items-center gap-1">
              <button type="button" onClick={(event) => { event.stopPropagation(); setShowEnglish((visible) => !visible); }}
                className="btn btn-ghost text-sm">
                {showEnglish ? "Hide English" : "Show English"}
              </button>
              {showEnglish && <p className="selectable text-base text-muted">{pinyin.meaning}</p>}
            </div>
          )}
        </div>
        <div className="flex min-h-0 flex-1 basis-1/2 flex-col items-center justify-center gap-3 overflow-y-auto border-t border-dashed border-border px-6 py-6 text-center">
          {revealed ? (
            <div key={card.id} className="reveal-in flex flex-col items-center gap-3">
              <div className="flex items-center gap-2">
                <span lang={pinyin ? "zh-Latn-pinyin" : backLang} className="selectable text-3xl break-words text-foreground/90">
                  {pinyin ? pinyin.syllables.join(" ") : card.back}
                </span>
                {!pinyin && <TtsButton text={card.back} lang={backLang} />}
              </div>
              {card.notes && <p className="selectable text-base text-muted">{card.notes}</p>}
            </div>
          ) : (
            <span className="text-sm text-muted">Tap to reveal · Space</span>
          )}
        </div>
      </div>

      {/* Bottom bar keeps one height in both states — no layout shift. */}
      <div className="flex min-h-28 items-center py-3">
        {revealed ? (
          <RatingBar fsrs={card.fsrs} onRate={rate} />
        ) : (
          <button type="button" onClick={reveal} className="btn btn-primary btn-lg w-full">
            Show answer
          </button>
        )}
      </div>
    </div>
  );
}
