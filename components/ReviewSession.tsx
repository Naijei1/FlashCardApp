"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Card } from "@/lib/types";
import type { IntervalPreview } from "@/lib/fsrs";
import { DEFAULT_BACK_LANG, DEFAULT_FRONT_LANG } from "@/lib/languages";
import TtsButton from "./TtsButton";
import { useKeyboard } from "./useKeyboard";

type QueueItem = { card: Card; intervals: IntervalPreview };
type DeckLangs = Record<string, { front?: string; back?: string }>;

// Cards rated Again/Hard land in a learning step minutes away; keep them in
// this session rather than making the user restart.
const SESSION_HORIZON_MS = 15 * 60_000;

const RATINGS = [
  { value: 1, key: "again" as const, label: "Again", classes: "text-red-500 border-red-500/40" },
  { value: 2, key: "hard" as const, label: "Hard", classes: "text-amber-500 border-amber-500/40" },
  { value: 3, key: "good" as const, label: "Good", classes: "text-green-600 border-green-600/40" },
  { value: 4, key: "easy" as const, label: "Easy", classes: "text-sky-500 border-sky-500/40" },
];

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
  const [revealed, setRevealed] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const [error, setError] = useState("");
  const busyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/review/queue?deckId=${encodeURIComponent(deckId)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data) => {
        if (!cancelled) setQueue(data.queue);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load the review queue.");
      });
    return () => {
      cancelled = true;
    };
  }, [deckId]);

  const rate = useCallback(
    async (rating: number) => {
      if (!queue || queue.length === 0 || busyRef.current) return;
      busyRef.current = true;
      const current = queue[0];
      try {
        const res = await fetch("/api/review", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cardId: current.card.id,
            deckId: current.card.deckId,
            rating,
          }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const data: { card: Card; intervals: IntervalPreview } = await res.json();
        setReviewed((n) => n + 1);
        setRevealed(false);
        setQueue((q) => {
          if (!q) return q;
          const rest = q.slice(1);
          const dueSoon =
            new Date(data.card.fsrs.due).getTime() <= Date.now() + SESSION_HORIZON_MS;
          return dueSoon ? [...rest, { card: data.card, intervals: data.intervals }] : rest;
        });
      } catch {
        setError("Saving the review failed — check your connection and try again.");
      } finally {
        busyRef.current = false;
      }
    },
    [queue]
  );

  useKeyboard((event) => {
    if (event.key === " ") {
      event.preventDefault();
      if (!revealed) setRevealed(true);
    } else if (revealed && ["1", "2", "3", "4"].includes(event.key)) {
      rate(Number(event.key));
    }
  });

  if (error) {
    return <Screen backHref={backHref} title="Something went wrong" body={error} />;
  }
  if (queue === null) {
    return <Screen backHref={backHref} title="Loading…" body="" />;
  }
  if (queue.length === 0) {
    return (
      <Screen
        backHref={backHref}
        title={reviewed > 0 ? "Session complete 🎉" : "Nothing due"}
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
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-4 pb-safe-4">
      <header className="flex items-center justify-between py-3">
        <Link href={backHref} className="rounded-lg px-3 py-2 text-muted">
          ← Back
        </Link>
        <span className="text-sm text-muted">{queue.length} left</span>
        <span className="w-16 text-right text-sm text-muted">{reviewed} done</span>
      </header>

      <button
        type="button"
        onClick={() => setRevealed(true)}
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

      <div className="py-4">
        {revealed ? (
          <div className="grid grid-cols-4 gap-2">
            {RATINGS.map((r) => (
              <button
                key={r.value}
                onClick={() => rate(r.value)}
                className={`flex min-h-16 flex-col items-center justify-center rounded-xl border bg-surface font-medium ${r.classes}`}
              >
                {r.label}
                <span className="text-xs text-muted">{intervals[r.key]}</span>
              </button>
            ))}
          </div>
        ) : (
          <button
            onClick={() => setRevealed(true)}
            className="min-h-16 w-full rounded-xl bg-accent text-lg font-medium text-accent-foreground"
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
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-xl font-semibold">{title}</h1>
      {body && <p className="text-muted">{body}</p>}
      <Link href={backHref} className="mt-2 rounded-xl bg-accent px-5 py-3 font-medium text-accent-foreground">
        ← Back
      </Link>
    </div>
  );
}
