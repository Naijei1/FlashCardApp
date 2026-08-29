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
import { DEFAULT_BACK_LANG, DEFAULT_FRONT_LANG } from "@/lib/languages";
import { getBreakUntil, startBreak } from "@/lib/study-break";
import BreakScreen from "./BreakScreen";
import RatingBar from "./RatingBar";
import { createReviewSync } from "./reviewSync";
import TtsButton from "./TtsButton";
import { useKeyboard } from "./useKeyboard";

type QueueItem = { card: Card; intervals: IntervalPreview };
type DeckLangs = Record<string, { front?: string; back?: string }>;

// Cards rated Retry/Hard land in a learning step minutes away; keep them in
// this session rather than making the user restart.
const SESSION_HORIZON_MS = 15 * 60_000;
// Ignore ratings briefly after a new card appears so a double-tap on a rating
// button can't accidentally rate the next card too.
const RATE_LOCKOUT_MS = 250;

export default function ReviewSession({
  deckId,
  deckLangs,
  backHref,
}: {
  deckId: string;
  deckLangs: DeckLangs;
  backHref: string;
}) {
  const [queue, setQueue] = useState<QueueItem[] | null>(null);
  const [totalDue, setTotalDue] = useState(0);
  const [batchSize, setBatchSize] = useState(0);
  const [breakUntil, setBreakUntil] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const [saveFailures, setSaveFailures] = useState(0);
  const advancedAtRef = useRef(0);
  const sync = useMemo(() => createReviewSync(setSaveFailures), []);

  const loadQueue = useCallback(() => {
    setQueue(null);
    fetch(`/api/review/queue?deckId=${encodeURIComponent(deckId)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: { queue: QueueItem[]; totalDue: number }) => {
        setQueue(data.queue);
        setTotalDue(data.totalDue);
        setBatchSize(data.queue.length);
      })
      .catch(() => setLoadError(true));
  }, [deckId]);

  useEffect(() => {
    // An unfinished break (even across a reload) blocks the next batch.
    const until = getBreakUntil();
    if (until > Date.now()) {
      setBreakUntil(until);
      setQueue([]);
    } else {
      loadQueue();
    }
  }, [loadQueue]);

  const reveal = useCallback(() => setRevealed(true), []);

  const rate = useCallback(
    (rating: number) => {
      if (!queue || queue.length === 0) return;
      if (performance.now() - advancedAtRef.current < RATE_LOCKOUT_MS) return;
      advancedAtRef.current = performance.now();
      navigator.vibrate?.(10);

      const current = queue[0];
      // Persist in the background; advance instantly.
      sync.push({ cardId: current.card.id, deckId: current.card.deckId, rating });

      // Compute the new state locally just for the session queue: re-enqueue
      // cards that come back within this session's horizon. The server's
      // recomputation stays canonical for storage.
      const now = new Date();
      const { fsrs } = applyRating(current.card.fsrs, rating as Grade, now);
      const dueSoon = new Date(fsrs.due).getTime() <= now.getTime() + SESSION_HORIZON_MS;

      setReviewed((n) => n + 1);
      setRevealed(false);
      setQueue((q) => {
        if (!q) return q;
        const rest = q.slice(1);
        const next = dueSoon
          ? [...rest, { card: { ...current.card, fsrs }, intervals: previewIntervals(fsrs, new Date(fsrs.due)) }]
          : rest;
        if (next.length === 0 && totalDue > batchSize) {
          // Batch finished with more cards waiting — enforce the pause.
          setBreakUntil(startBreak());
        }
        return next;
      });
    },
    [queue, sync, totalDue, batchSize]
  );

  useKeyboard((event) => {
    if (event.key === " ") {
      event.preventDefault();
      if (revealed) rate(3);
      else reveal();
    } else if (event.key === "Enter") {
      if (revealed) rate(3);
      else reveal();
    } else if (revealed && ["1", "2", "3", "4"].includes(event.key)) {
      rate(Number(event.key));
    }
  });

  if (loadError) {
    return (
      <Screen backHref={backHref} title="Something went wrong" body="Could not load the review queue." />
    );
  }
  if (breakUntil > 0 && (queue === null || queue.length === 0)) {
    return (
      <BreakScreen
        until={breakUntil}
        reviewed={reviewed}
        waiting={reviewed > 0 ? Math.max(totalDue - batchSize, 0) : null}
        backHref={backHref}
        onContinue={() => {
          setBreakUntil(0);
          setReviewed(0);
          loadQueue();
        }}
      />
    );
  }
  if (queue === null) {
    return <Screen backHref={backHref} title="" body="" />;
  }
  if (queue.length === 0) {
    return (
      <Screen
        backHref={backHref}
        title={reviewed > 0 ? "Session complete" : "Nothing due"}
        body={
          reviewed > 0
            ? `You reviewed ${reviewed} card${reviewed === 1 ? "" : "s"}.`
            : "No cards are due right now — come back later."
        }
      />
    );
  }

  const { card, intervals } = queue[0];
  const frontLang = deckLangs[card.deckId]?.front || DEFAULT_FRONT_LANG;
  const backLang = deckLangs[card.deckId]?.back || DEFAULT_BACK_LANG;

  return (
    <div className="study-surface mx-auto flex h-dvh w-full max-w-2xl flex-col px-4 pb-safe">
      <header className="flex items-center justify-between py-2">
        <Link href={backHref} className="pressable rounded-lg px-3 py-2 text-muted">
          ← Back
        </Link>
        <span className="text-sm tabular-nums text-muted">
          {queue.length} left{totalDue > batchSize ? ` · ${totalDue - batchSize} waiting` : ""}
        </span>
        <span className="w-16 text-right text-sm tabular-nums text-muted">{reviewed} done</span>
      </header>

      {saveFailures > 0 && (
        <p className="mb-2 rounded-lg bg-red-500/10 px-3 py-2 text-center text-xs text-red-500">
          {saveFailures} review{saveFailures === 1 ? "" : "s"} failed to save — check your
          connection.
        </p>
      )}

      {/* Tap anywhere on the card to reveal; two fixed halves so nothing jumps. */}
      <div
        role="button"
        tabIndex={-1}
        onClick={reveal}
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
            <div key={card.id} className="reveal-in flex flex-col items-center gap-3">
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

      {/* Bottom bar keeps one height in both states — no layout shift. */}
      <div className="flex min-h-24 items-center py-3">
        {revealed ? (
          <RatingBar intervals={intervals} onRate={rate} />
        ) : (
          <button
            type="button"
            onClick={reveal}
            className="pressable min-h-16 w-full rounded-2xl bg-accent text-lg font-semibold text-accent-foreground"
          >
            Show answer
          </button>
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
