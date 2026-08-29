"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Card } from "@/lib/types";
import {
  applyRating,
  previewIntervals,
  type Grade,
  type IntervalPreview,
} from "@/lib/fsrs";
import {
  checkAnswer,
  chineseSideForCard,
  diffChars,
  toWritePrompt,
  type ChineseSide,
  type DiffChar,
} from "@/lib/write";
import RatingBar from "./RatingBar";
import { createReviewSync } from "./reviewSync";
import TtsButton from "./TtsButton";
import { useKeyboard } from "./useKeyboard";

type QueueItem = { card: Card; intervals: IntervalPreview };

const SESSION_HORIZON_MS = 15 * 60_000;
const RATE_LOCKOUT_MS = 250;

type Result = {
  correct: boolean;
  typed: DiffChar[];
  expected: DiffChar[];
};

export default function WriteSession({
  deckId,
  deckSide,
  chineseLang,
  backHref,
}: {
  deckId: string;
  /** Deck-level fallback; each card's side is detected from its own text. */
  deckSide: ChineseSide | null;
  chineseLang: string;
  backHref: string;
}) {
  const [queue, setQueue] = useState<QueueItem[] | null>(null);
  const [value, setValue] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [reviewed, setReviewed] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const [saveFailures, setSaveFailures] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const advancedAtRef = useRef(0);
  const sync = useMemo(() => createReviewSync(setSaveFailures), []);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/review/queue?deckId=${encodeURIComponent(deckId)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: { queue: QueueItem[] }) => {
        if (cancelled) return;
        setQueue(
          data.queue.filter(
            (item) => chineseSideForCard(item.card, deckSide) !== null
          )
        );
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [deckId, deckSide]);

  const current = queue?.[0];
  const currentSide = current
    ? chineseSideForCard(current.card, deckSide)
    : null;
  const prompt =
    current && currentSide ? toWritePrompt(current.card, currentSide) : null;

  const check = useCallback(
    (giveUp = false) => {
      if (!prompt || result) return;
      const typed = giveUp ? "" : value;
      const correct = checkAnswer(typed, prompt.answer);
      navigator.vibrate?.(10);
      setResult({ correct, ...diffChars(typed, prompt.answer) });
    },
    [prompt, result, value]
  );

  const rate = useCallback(
    (rating: number) => {
      if (!queue || queue.length === 0 || !result) return;
      if (performance.now() - advancedAtRef.current < RATE_LOCKOUT_MS) return;
      advancedAtRef.current = performance.now();
      navigator.vibrate?.(10);

      const item = queue[0];
      sync.push({ cardId: item.card.id, deckId: item.card.deckId, rating });

      const now = new Date();
      const { fsrs } = applyRating(item.card.fsrs, rating as Grade, now);
      const dueSoon = new Date(fsrs.due).getTime() <= now.getTime() + SESSION_HORIZON_MS;

      setReviewed((n) => n + 1);
      setResult(null);
      setValue("");
      setQueue((q) => {
        if (!q) return q;
        const rest = q.slice(1);
        if (!dueSoon) return rest;
        const card = { ...item.card, fsrs };
        return [...rest, { card, intervals: previewIntervals(fsrs, new Date(fsrs.due)) }];
      });
      // Called from a tap/keypress, so refocusing keeps the keyboard up on iOS.
      inputRef.current?.focus();
    },
    [queue, result, sync]
  );

  const defaultRating = result ? (result.correct ? 3 : 1) : 3;

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    // Never treat the Enter that confirms a pinyin/IME candidate as a submit.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (!result) {
      if (event.key === "Enter" && value.trim()) {
        event.preventDefault();
        check();
      }
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      rate(defaultRating);
    } else if (["1", "2", "3", "4"].includes(event.key)) {
      event.preventDefault();
      rate(Number(event.key));
    }
  }

  // Same shortcuts when focus is outside the input (the hook skips form fields).
  useKeyboard((event) => {
    if (!result) return;
    if (event.key === "Enter") rate(defaultRating);
    else if (["1", "2", "3", "4"].includes(event.key)) rate(Number(event.key));
  });

  if (loadError) {
    return (
      <Screen backHref={backHref} title="Something went wrong" body="Could not load the queue." />
    );
  }
  if (queue === null) {
    return <Screen backHref={backHref} title="" body="" />;
  }
  if (queue.length === 0 || !current || !prompt) {
    return (
      <Screen
        backHref={backHref}
        title={reviewed > 0 ? "Session complete 🎉" : "Nothing due"}
        body={
          reviewed > 0
            ? `You wrote ${reviewed} card${reviewed === 1 ? "" : "s"}.`
            : "No cards are due right now — come back later."
        }
      />
    );
  }

  return (
    <div className="study-surface mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-4 pb-safe">
      <header className="flex items-center justify-between py-2">
        <Link href={backHref} className="pressable rounded-lg px-3 py-2 text-muted">
          ← Back
        </Link>
        <span className="text-sm tabular-nums text-muted">{queue.length} left</span>
        <span className="w-16 text-right text-sm tabular-nums text-muted">{reviewed} done</span>
      </header>

      {saveFailures > 0 && (
        <p className="mb-2 rounded-lg bg-red-500/10 px-3 py-2 text-center text-xs text-red-500">
          {saveFailures} review{saveFailures === 1 ? "" : "s"} failed to save — check your
          connection.
        </p>
      )}

      <div className="flex flex-col rounded-2xl border border-border bg-surface px-5 py-6">
        <div className="text-center">
          <span className="selectable text-3xl font-medium break-words sm:text-4xl">
            {prompt.prompt}
          </span>
        </div>

        <label className="mt-6 block text-sm text-muted" htmlFor="write-input">
          Write the Chinese:
        </label>
        <input
          id="write-input"
          ref={inputRef}
          lang={chineseLang}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onInputKeyDown}
          readOnly={!!result}
          autoFocus
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint={result ? "next" : "go"}
          placeholder={result ? "" : "输入中文…"}
          className={`mt-2 w-full rounded-xl border bg-background px-4 py-3 text-center text-2xl outline-none transition-colors duration-150 ${
            result
              ? result.correct
                ? "border-green-600/60"
                : "border-red-500/60"
              : "border-border focus:border-accent"
          }`}
        />

        {/* Result area: reserved so checking doesn't shift the layout. */}
        <div className="mt-5 flex min-h-36 flex-col items-center justify-start gap-2 text-center">
          {result ? (
            <div key={current.card.id} className="reveal-in flex flex-col items-center gap-2">
              {result.correct ? (
                <p className="text-lg font-medium text-green-600 dark:text-green-400">
                  ✓ Correct
                </p>
              ) : (
                <>
                  <p className="text-lg font-medium text-red-500">✕ Incorrect</p>
                  {result.typed.length > 0 && (
                    <p className="text-sm text-muted">
                      Your answer:{" "}
                      <span lang={chineseLang} className="selectable text-2xl">
                        {result.typed.map((c, i) => (
                          <span
                            key={i}
                            className={
                              c.ok
                                ? "text-foreground"
                                : "rounded bg-red-500/15 text-red-500"
                            }
                          >
                            {c.char}
                          </span>
                        ))}
                      </span>
                    </p>
                  )}
                </>
              )}
              <div className="flex items-center gap-2">
                <span lang={chineseLang} className="selectable text-4xl break-words">
                  {result.expected.map((c, i) => (
                    <span
                      key={i}
                      className={
                        result.correct || c.ok
                          ? ""
                          : "rounded bg-green-500/15 text-green-700 dark:text-green-400"
                      }
                    >
                      {c.char}
                    </span>
                  ))}
                </span>
                <TtsButton text={prompt.answer} lang={chineseLang} />
              </div>
              {prompt.notes && (
                <p className="selectable text-sm text-muted">{prompt.notes}</p>
              )}
            </div>
          ) : (
            <span className="text-xs text-muted">Enter ↵ to check</span>
          )}
        </div>
      </div>

      {/* Bottom bar keeps one height in both phases. */}
      <div className="flex min-h-24 items-center gap-2 py-3">
        {result ? (
          <RatingBar intervals={current.intervals} onRate={rate} defaultValue={defaultRating} />
        ) : (
          <>
            <button
              type="button"
              onClick={() => check(true)}
              className="pressable min-h-16 rounded-2xl border border-border bg-surface px-4 text-sm text-muted"
            >
              Don&apos;t know
            </button>
            <button
              type="button"
              onClick={() => check()}
              disabled={!value.trim()}
              className="pressable min-h-16 flex-1 rounded-2xl bg-accent text-lg font-semibold text-accent-foreground disabled:opacity-40"
            >
              Check answer
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function Screen({ backHref, title, body }: { backHref: string; title: string; body: string }) {
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-3 px-6 pb-safe text-center">
      {title && <h1 className="text-xl font-semibold">{title}</h1>}
      {body && <p className="text-muted">{body}</p>}
      <Link
        href={backHref}
        className="pressable mt-2 rounded-xl bg-accent px-5 py-3 font-medium text-accent-foreground"
      >
        ← Back
      </Link>
    </div>
  );
}
