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
    if (event.key === " ") {
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
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-4 pb-safe-4">
      <header className="flex items-center justify-between py-3">
        <Link href={backHref} className="rounded-lg px-3 py-2 text-muted">
          ← Back
        </Link>
        <span className="text-sm text-muted">
          {index + 1} / {order.length}
        </span>
        <div className="flex gap-1">
          <button
            onClick={() => {
              setOrder((o) => shuffle(o));
              setIndex(0);
              setRevealed(false);
            }}
            className="rounded-lg px-3 py-2 text-sm text-muted hover:text-foreground"
          >
            Shuffle
          </button>
          <button
            onClick={() => {
              setOrder(initialOrder);
              setIndex(0);
              setRevealed(false);
            }}
            className="rounded-lg px-3 py-2 text-sm text-muted hover:text-foreground"
          >
            Restart
          </button>
        </div>
      </header>

      <button
        type="button"
        onClick={() => setRevealed((r) => !r)}
        className="flex flex-1 flex-col items-center justify-center gap-6 rounded-2xl border border-border bg-surface p-6 text-center"
      >
        <div className="flex items-center gap-2">
          <span className="text-5xl leading-tight break-words sm:text-6xl">{card.front}</span>
          <TtsButton text={card.front} lang={frontLang} />
        </div>
        {revealed ? (
          <>
            <hr className="w-24 border-border" />
            <div className="flex items-center gap-2">
              <span className="text-3xl break-words text-foreground/90">{card.back}</span>
              <TtsButton text={card.back} lang={backLang} />
            </div>
            {card.notes && <p className="text-base text-muted">{card.notes}</p>}
          </>
        ) : (
          <span className="text-sm text-muted">Tap to reveal · Space</span>
        )}
      </button>

      <div className="flex gap-3 py-4">
        <button
          onClick={() => go(-1)}
          disabled={index === 0}
          className="min-h-14 flex-1 rounded-xl border border-border bg-surface text-lg font-medium disabled:opacity-40"
        >
          ← Previous
        </button>
        <button
          onClick={() => go(1)}
          disabled={index === order.length - 1}
          className="min-h-14 flex-1 rounded-xl border border-border bg-surface text-lg font-medium disabled:opacity-40"
        >
          Next →
        </button>
      </div>
    </div>
  );
}

function Empty({ backHref, title, body }: { backHref: string; title: string; body: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-muted">{body}</p>
      <Link href={backHref} className="mt-2 rounded-xl bg-accent px-5 py-3 font-medium text-accent-foreground">
        ← Back
      </Link>
    </div>
  );
}
