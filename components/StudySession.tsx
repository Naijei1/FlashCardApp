"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { Card } from "@/lib/types";
import { shuffle } from "@/lib/due";
import { DEFAULT_BACK_LANG, DEFAULT_FRONT_LANG } from "@/lib/languages";
import TtsButton from "./TtsButton";
import { useKeyboard } from "./useKeyboard";

type DeckLangs = Record<string, { front?: string; back?: string }>;

/** Casual flipping through a deck. Never touches FSRS state. */
export default function StudySession({
  cards,
  deckLangs,
  backHref,
}: {
  cards: Card[];
  deckLangs: DeckLangs;
  backHref: string;
}) {
  const initialOrder = useMemo(() => cards.map((_, i) => i), [cards]);
  const [order, setOrder] = useState(initialOrder);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);

  const card = cards[order[index]];

  function go(delta: number) {
    setIndex((i) => Math.min(Math.max(i + delta, 0), order.length - 1));
    setRevealed(false);
  }

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

  if (cards.length === 0) {
    return (
      <Empty backHref={backHref} title="No cards to study" body="Add some cards first." />
    );
  }

  const frontLang = deckLangs[card.deckId]?.front || DEFAULT_FRONT_LANG;
  const backLang = deckLangs[card.deckId]?.back || DEFAULT_BACK_LANG;

  return (
    <div className="study-surface mx-auto flex h-dvh w-full max-w-2xl flex-col px-4 pb-safe">
      <header className="flex items-center justify-between py-2">
        <Link href={backHref} className="pressable rounded-lg px-3 py-2 text-muted">
          ← Back
        </Link>
        <span className="text-sm tabular-nums text-muted">
          {index + 1} / {order.length}
        </span>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => {
              setOrder((o) => shuffle(o));
              setIndex(0);
              setRevealed(false);
            }}
            className="pressable rounded-lg px-3 py-2 text-sm text-muted hover:text-foreground"
          >
            Shuffle
          </button>
          <button
            type="button"
            onClick={() => {
              setOrder(initialOrder);
              setIndex(0);
              setRevealed(false);
            }}
            className="pressable rounded-lg px-3 py-2 text-sm text-muted hover:text-foreground"
          >
            Restart
          </button>
        </div>
      </header>

      {/* Tap anywhere on the card to flip; two fixed halves so nothing jumps. */}
      <div
        onClick={() => setRevealed((r) => !r)}
        className="flex min-h-0 flex-1 cursor-pointer flex-col overflow-hidden rounded-2xl border border-border bg-surface"
      >
        <div className="flex min-h-0 flex-1 basis-1/2 items-center justify-center gap-2 overflow-y-auto px-6 py-4 text-center">
          <span
            lang={frontLang}
            className="selectable text-5xl leading-tight break-words sm:text-6xl"
          >
            {card.front}
          </span>
          <TtsButton text={card.front} lang={frontLang} />
        </div>
        <div className="flex min-h-0 flex-1 basis-1/2 flex-col items-center justify-center gap-3 overflow-y-auto border-t border-border px-6 py-4 text-center">
          {revealed ? (
            <div
              key={`${card.id}-${index}`}
              className="reveal-in flex flex-col items-center gap-3"
            >
              <div className="flex items-center gap-2">
                <span
                  lang={backLang}
                  className="selectable text-3xl break-words text-foreground/90"
                >
                  {card.back}
                </span>
                <TtsButton text={card.back} lang={backLang} />
              </div>
              {card.notes && <p className="selectable text-base text-muted">{card.notes}</p>}
            </div>
          ) : (
            <span className="text-sm text-muted">Tap to reveal · Space</span>
          )}
        </div>
      </div>

      <div className="flex min-h-24 items-center gap-3 py-3">
        <button
          type="button"
          onClick={() => go(-1)}
          disabled={index === 0}
          className="pressable min-h-16 flex-1 rounded-2xl border border-border bg-surface text-lg font-medium disabled:opacity-40"
        >
          ← Previous
        </button>
        <button
          type="button"
          onClick={() => setRevealed((current) => !current)}
          className="pressable min-h-16 flex-1 rounded-2xl bg-accent px-2 font-medium text-accent-foreground"
        >
          {revealed ? "Hide" : "Reveal"}
        </button>
        <button
          type="button"
          onClick={() => go(1)}
          disabled={index === order.length - 1}
          className="pressable min-h-16 flex-1 rounded-2xl border border-border bg-surface text-lg font-medium disabled:opacity-40"
        >
          Next →
        </button>
      </div>
    </div>
  );
}

function Empty({ backHref, title, body }: { backHref: string; title: string; body: string }) {
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-3 px-6 pb-safe text-center">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-muted">{body}</p>
      <Link
        href={backHref}
        className="pressable mt-2 rounded-xl bg-accent px-5 py-3 font-medium text-accent-foreground"
      >
        ← Back
      </Link>
    </div>
  );
}
