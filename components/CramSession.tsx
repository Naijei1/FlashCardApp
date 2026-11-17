"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { CramCard } from "@/lib/cram";
import { shuffle } from "@/lib/due";
import { plural } from "@/lib/plural";
import CharacterText from "./CharacterText";
import TtsButton from "./TtsButton";
import { useKeyboard } from "./useKeyboard";

type Result = "got" | "missed";

/**
 * Cram a saved group: every card once, shuffled, marked Got it / Missed.
 * Session-local only. It never calls the review API, never queues offline
 * reviews, and never changes FSRS, hard-word marks, or weekly progress.
 */
export default function CramSession({
  cards,
  backHref,
  title,
  random = Math.random,
}: {
  cards: CramCard[];
  backHref: string;
  title: string;
  random?: () => number;
}) {
  const [round, setRound] = useState<CramCard[] | null>(null);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [results, setResults] = useState<Record<string, Result>>({});
  const [redrill, setRedrill] = useState(false);

  // Shuffle after mount so SSR markup matches hydration.
  useEffect(() => {
    setRound(shuffle(cards, random));
    setIndex(0);
    setRevealed(false);
    setResults({});
    setRedrill(false);
  }, [cards, random]);

  function start(next: CramCard[], isRedrill: boolean) {
    setRound(shuffle(next, random));
    setIndex(0);
    setRevealed(false);
    setResults({});
    setRedrill(isRedrill);
  }

  const card = round?.[index];

  function mark(result: Result) {
    if (!card || !revealed) return;
    setResults((current) => ({ ...current, [card.key]: result }));
    setIndex((i) => i + 1);
    setRevealed(false);
  }

  function undo() {
    if (!round || index === 0) return;
    const previous = round[index - 1];
    setResults((current) => {
      const next = { ...current };
      delete next[previous.key];
      return next;
    });
    setIndex(index - 1);
    setRevealed(true);
  }

  useKeyboard((event) => {
    if (!card) return;
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      if (!revealed) setRevealed(true);
      else mark("got");
    } else if (revealed && (event.key === "1" || event.key === "ArrowLeft")) {
      mark("missed");
    } else if (revealed && (event.key === "2" || event.key === "ArrowRight")) {
      mark("got");
    }
  });

  const got = Object.values(results).filter((r) => r === "got").length;
  const missed = Object.values(results).filter((r) => r === "missed").length;

  if (cards.length === 0) {
    return (
      <div className="study-frame mx-auto flex max-w-md flex-col items-center justify-center gap-3 px-6 pt-safe pb-safe text-center">
        <h1 className="text-2xl font-semibold tracking-tight">No cards to practice</h1>
        <p className="text-muted">The lessons in this group have no cards you can study right now.</p>
        <Link href={backHref} className="btn btn-primary mt-2">← Back</Link>
      </div>
    );
  }

  if (!round) {
    return (
      <div className="study-frame mx-auto flex max-w-md flex-col items-center justify-center gap-3 px-6 pt-safe pb-safe text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Shuffling…</h1>
      </div>
    );
  }

  if (!card) {
    const missedCards = round.filter((item) => results[item.key] === "missed");
    const percent = round.length > 0 ? Math.round((got / round.length) * 100) : 0;
    return (
      <div className="study-frame mx-auto flex max-w-md flex-col items-center justify-center gap-4 px-6 pt-safe pb-safe text-center">
        <p className="eyebrow">{redrill ? "Missed words round" : "Cram round"} · {title}</p>
        <h1 className="text-2xl font-semibold tracking-tight">Round complete</h1>
        <div className="flex items-end gap-8">
          <div>
            <div className="text-5xl font-bold tracking-tight text-emerald-600 tabular-nums dark:text-emerald-400">{got}</div>
            <div className="mt-1 text-sm text-muted">got it</div>
          </div>
          <div>
            <div className="text-5xl font-bold tracking-tight text-accent tabular-nums">{missed}</div>
            <div className="mt-1 text-sm text-muted">missed</div>
          </div>
        </div>
        <p className="text-sm text-muted">{percent}% of {plural(round.length, "card")}. Practice only — your review schedule is unchanged.</p>
        <div className="mt-2 flex w-full flex-col gap-2">
          {missedCards.length > 0 && (
            <button type="button" onClick={() => start(missedCards, true)} className="btn btn-primary btn-lg w-full">
              Re-drill {plural(missedCards.length, "missed card")}
            </button>
          )}
          <button type="button" onClick={() => start(cards, false)}
            className={`btn btn-lg w-full ${missedCards.length > 0 ? "btn-secondary" : "btn-primary"}`}>
            Shuffle all {plural(cards.length, "card")} again
          </button>
          <Link href={backHref} className="btn btn-ghost">← Done</Link>
        </div>
      </div>
    );
  }

  const progress = round.length > 0 ? index / round.length : 0;
  const zhPrompt = card.promptLang.startsWith("zh");

  return (
    <div className="study-surface study-frame mx-auto flex w-full max-w-2xl flex-col px-safe pt-safe pb-safe lg:max-w-3xl">
      <header className="flex items-center gap-3 py-3">
        <Link href={backHref} className="btn btn-ghost -ml-2 shrink-0 px-3">← Back</Link>
        <div className="min-w-0 flex-1">
          <div className="flex justify-between text-xs tabular-nums text-muted">
            <span>{index + 1} / {round.length}{redrill ? " · missed" : ""}</span>
            <span><span className="text-emerald-600 dark:text-emerald-400">✓ {got}</span> · <span className="text-accent">✗ {missed}</span></span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-border/70" aria-hidden="true">
            <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${progress * 100}%` }} />
          </div>
        </div>
        <button type="button" onClick={undo} disabled={index === 0} className="btn btn-ghost shrink-0 px-2.5">Undo</button>
      </header>
      <p className="-mt-1 mb-2 text-center text-xs text-muted">Cram mode · doesn’t change your review schedule</p>

      <div key={`${card.key}-${index}`} onClick={() => setRevealed(true)}
        className="flashcard flex min-h-0 flex-1 cursor-pointer flex-col overflow-hidden">
        <div className="flex min-h-0 flex-1 basis-1/2 items-center justify-center gap-2 overflow-y-auto px-6 py-6 text-center">
          <CharacterText text={card.prompt} lang={card.promptLang} deckId={card.deckId} cardId={card.id}
            className={zhPrompt ? "hanzi selectable break-words" : "selectable text-5xl leading-tight font-medium break-words sm:text-6xl"} />
          <TtsButton text={card.prompt} lang={card.promptLang} />
        </div>
        <div className="flex min-h-0 flex-1 basis-1/2 flex-col items-center justify-center gap-3 overflow-y-auto border-t border-dashed border-border px-6 py-6 text-center">
          {revealed ? (
            <div className="reveal-in flex flex-col items-center gap-3">
              {card.pinyin && (
                <CharacterText text={card.pinyin} lang="zh-Latn-pinyin" deckId={card.deckId} cardId={card.id}
                  className="pinyin selectable break-words" />
              )}
              <div className="flex items-center gap-2">
                <CharacterText text={card.answer} lang={card.answerLang} deckId={card.deckId} cardId={card.id}
                  className={card.answerLang.startsWith("zh") ? "hanzi selectable break-words" : "selectable text-2xl break-words text-foreground/90"} />
                {!zhPrompt && <TtsButton text={card.answer} lang={card.answerLang} />}
              </div>
              {card.notes && (
                <CharacterText text={card.notes} deckId={card.deckId} cardId={card.id} className="selectable text-base text-muted" />
              )}
              {card.sources.length > 0 && (
                <p className="text-xs text-muted">{card.sources.length > 1 ? "In " : "From "}{card.sources.join(" · ")}</p>
              )}
            </div>
          ) : (
            <span className="text-sm text-muted">
              <span className="touch-hint">Tap the card to reveal</span>
              <span className="kbd-hint">Click or press Space to reveal · 1 missed · 2 got it</span>
            </span>
          )}
        </div>
      </div>

      <div className="flex min-h-28 shrink-0 items-center gap-2 py-3">
        {revealed ? (
          <>
            <button type="button" onClick={() => mark("missed")} className="btn btn-secondary btn-lg flex-1">✗ Missed</button>
            <button type="button" onClick={() => mark("got")} className="btn btn-primary btn-lg flex-1">✓ Got it</button>
          </>
        ) : (
          <button type="button" onClick={() => setRevealed(true)} className="btn btn-primary btn-lg w-full">Show answer</button>
        )}
      </div>
    </div>
  );
}
