"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { shuffle } from "@/lib/due";
import { DEFAULT_BACK_LANG, DEFAULT_FRONT_LANG } from "@/lib/languages";
import type { StudyFlipCard } from "@/lib/study-sets";
import { wordKey } from "@/lib/words";
import HardWordButton from "./HardWordButton";
import TtsButton from "./TtsButton";
import { useKeyboard } from "./useKeyboard";
import { useSwipe } from "./useSwipe";

type DeckLangs = Record<string, { front?: string; back?: string }>;

/** Casual flipping through a deck. Never touches FSRS state. */
export default function StudySession({
  cards,
  deckLangs,
  backHref,
}: {
  cards: StudyFlipCard[];
  deckLangs: DeckLangs;
  backHref: string;
}) {
  const initialOrder = useMemo(() => cards.map((_, i) => i), [cards]);
  const [order, setOrder] = useState(initialOrder);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [marked, setMarked] = useState<Record<string, boolean>>({});

  // A refreshed card list must not keep indexes into the previous list.
  useEffect(() => {
    setOrder(initialOrder);
    setIndex(0);
    setRevealed(false);
  }, [initialOrder]);

  function go(delta: number) {
    setIndex((i) => Math.min(Math.max(i + delta, 0), order.length - 1));
    setRevealed(false);
  }

  function reorder(next: number[]) {
    setOrder(next);
    setIndex(0);
    setRevealed(false);
  }

  const swipe = useSwipe((direction) => go(direction === "left" ? 1 : -1));

  useKeyboard((event) => {
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      setRevealed((r) => !r);
    } else if (event.key === "ArrowRight") {
      go(1);
    } else if (event.key === "ArrowLeft") {
      go(-1);
    }
  });

  const selected = cards[order[index]];
  if (!selected) {
    return (
      <div className="study-frame mx-auto flex max-w-md flex-col items-center justify-center gap-3 px-6 pt-safe pb-safe text-center">
        <h1 className="text-2xl font-semibold tracking-tight">No cards to study</h1>
        <p className="text-muted">Add some cards first.</p>
        <Link href={backHref} className="btn btn-primary mt-2">← Back</Link>
      </div>
    );
  }

  const card = { ...selected, hard: marked[wordKey(selected)] ?? selected.hard };
  const frontLang = deckLangs[card.deckId]?.front || DEFAULT_FRONT_LANG;
  const backLang = deckLangs[card.deckId]?.back || DEFAULT_BACK_LANG;
  const progress = order.length > 0 ? (index + 1) / order.length : 0;

  return (
    <div className="study-surface study-frame mx-auto flex w-full max-w-2xl flex-col px-safe pt-safe pb-safe lg:max-w-3xl">
      <header className="flex items-center gap-3 py-3">
        <Link href={backHref} className="btn btn-ghost -ml-2 shrink-0 px-3">← Back</Link>
        <div className="min-w-0 flex-1">
          <div className="flex justify-between text-xs tabular-nums text-muted">
            <span>{index + 1} / {order.length}</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-border/70" aria-hidden="true">
            <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${progress * 100}%` }} />
          </div>
        </div>
        <button type="button" onClick={() => reorder(shuffle(order))} className="btn btn-ghost shrink-0 px-2.5">Shuffle</button>
        <button type="button" onClick={() => reorder(initialOrder)} className="btn btn-ghost hidden shrink-0 px-2.5 sm:inline-flex">Restart</button>
        <HardWordButton key={`${card.deckId}:${card.id}`} card={card}
          onChange={(hard) => setMarked((current) => ({ ...current, [wordKey(card)]: hard }))} />
      </header>

      {/* Tap anywhere on the card to flip; two fixed halves so nothing jumps. */}
      <div key={`${card.id}-${index}`} {...swipe.handlers} onClick={() => { if (!swipe.consumeClick()) setRevealed((r) => !r); }}
        className="swipeable flashcard flex min-h-0 flex-1 cursor-pointer flex-col overflow-hidden">
        <div className="flex min-h-0 flex-1 basis-1/2 items-center justify-center gap-2 overflow-y-auto px-6 py-6 text-center">
          <span lang={frontLang} className="selectable text-5xl leading-tight font-medium break-words sm:text-6xl">
            {card.front}
          </span>
          <TtsButton text={card.front} lang={frontLang} />
        </div>
        <div className="flex min-h-0 flex-1 basis-1/2 flex-col items-center justify-center gap-3 overflow-y-auto border-t border-dashed border-border px-6 py-6 text-center">
          {revealed ? (
            <div key={`${card.id}-${index}`} className="reveal-in flex flex-col items-center gap-3">
              <div className="flex items-center gap-2">
                <span lang={backLang} className="selectable text-3xl break-words text-foreground/90">
                  {card.back}
                </span>
                <TtsButton text={card.back} lang={backLang} />
              </div>
              {card.notes && <p className="selectable text-base text-muted">{card.notes}</p>}
            </div>
          ) : (
            <span className="text-sm text-muted">
              <span className="touch-hint">Tap to flip · swipe for next</span>
              <span className="kbd-hint">Click or press Space to flip · ←/→ to move</span>
            </span>
          )}
        </div>
      </div>

      <div className="flex min-h-28 shrink-0 items-center gap-2 py-3">
        <button type="button" onClick={() => go(-1)} disabled={index === 0} className="btn btn-secondary btn-lg flex-1">
          ← Prev
        </button>
        <button type="button" onClick={() => setRevealed((current) => !current)} className="btn btn-primary btn-lg flex-1">
          {revealed ? "Hide" : "Reveal"}
        </button>
        <button type="button" onClick={() => go(1)} disabled={index === order.length - 1} className="btn btn-secondary btn-lg flex-1">
          Next →
        </button>
      </div>
    </div>
  );
}
