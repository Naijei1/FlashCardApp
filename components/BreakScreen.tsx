"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { plural } from "@/lib/plural";
import { clearBreak, formatCountdown, type StudyBreakScope } from "@/lib/study-break";
import { IconClock } from "./icons";
import type { ReviewSyncState } from "./reviewSync";
import SyncNotice from "./SyncNotice";

/** Enforced 5-minute pause between review batches. */
export default function BreakScreen({
  until,
  reviewed,
  waiting,
  syncState,
  scope,
  backHref,
  onContinue,
  onRetrySaves,
  note,
}: {
  until: number;
  /** Cards rated in the batch just finished (0 when resuming a stored break). */
  reviewed: number;
  /** Cards still waiting after the break, if known. */
  waiting: number | null;
  syncState: ReviewSyncState;
  scope: StudyBreakScope;
  backHref: string;
  onContinue: () => void;
  onRetrySaves: () => void;
  /** Learning cards that will return later, shown under the summary. */
  note?: string;
}) {
  const [msLeft, setMsLeft] = useState(() => until - Date.now());

  useEffect(() => {
    const tick = () => setMsLeft(until - Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [until]);

  const done = msLeft <= 0;
  const savesPending = syncState.pendingCount > 0;

  return (
    <div className="mx-auto flex h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 pb-safe text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-accent/10 text-3xl text-accent">
        <IconClock strokeWidth={1.8} />
      </span>
      <h1 className="text-2xl font-semibold tracking-tight">
        {reviewed > 0 ? "Batch complete — take a break" : "Break time"}
      </h1>
      <p className="text-muted">
        {reviewed > 0 && `You reviewed ${plural(reviewed, "card")}. `}
        {waiting !== null && waiting > 0
          ? `${plural(waiting, "more card")} waiting after a short rest.`
          : "A short rest helps the next batch stick."}
      </p>
      {note && <p className="text-sm text-muted">↻ {note}.</p>}
      <SyncNotice state={syncState} onRetry={onRetrySaves} />
      <div
        className="text-6xl font-semibold tabular-nums tracking-tight"
        role="timer"
        aria-label={`Break time remaining: ${formatCountdown(msLeft)}`}
        aria-live="off"
      >
        {formatCountdown(msLeft)}
      </div>
      {done && (
        <span className="sr-only" role="status">
          Break complete.
        </span>
      )}
      <button
        type="button"
        disabled={!done || savesPending}
        onClick={() => {
          clearBreak(scope);
          onContinue();
        }}
        className="btn btn-primary btn-lg w-full max-w-xs"
      >
        {!done ? "Resting…" : savesPending ? "Waiting for reviews to save…" : "Continue"}
      </button>
      <Link href={backHref} className="btn btn-ghost text-sm">
        ← Back to deck
      </Link>
    </div>
  );
}
