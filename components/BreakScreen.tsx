"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  clearBreak,
  formatCountdown,
  type StudyBreakScope,
} from "@/lib/study-break";
import type { ReviewSyncState } from "./reviewSync";
import { IconClock } from "./icons";

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
    <div className="flex h-dvh flex-col items-center justify-center gap-4 px-6 pb-safe text-center">
      <IconClock className="text-4xl text-muted" strokeWidth={1.5} />
      <h1 className="text-xl font-semibold">
        {reviewed > 0 ? "Batch complete — take a break" : "Break time"}
      </h1>
      <p className="text-muted">
        {reviewed > 0 && `You reviewed ${reviewed} card${reviewed === 1 ? "" : "s"}. `}
        {waiting !== null && waiting > 0
          ? `${waiting} more card${waiting === 1 ? "" : "s"} waiting after a short rest.`
          : "A short rest helps the next batch stick."}
      </p>
      {savesPending && (
        <div className="flex flex-col items-center gap-2">
          <p
            role={syncState.failedCount > 0 ? "alert" : undefined}
            className={
              syncState.failedCount > 0
                ? "rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500"
                : "text-sm text-muted"
            }
          >
            {syncState.blockedCount > 0
              ? `${syncState.blockedCount} review${syncState.blockedCount === 1 ? "" : "s"} cannot be saved because the card changed or was removed. Discard to continue.`
              : syncState.failedCount > 0
                ? `${syncState.failedCount} review${syncState.failedCount === 1 ? "" : "s"} still need to be saved.`
              : `Saving ${syncState.pendingCount} review${syncState.pendingCount === 1 ? "" : "s"}…`}
          </p>
          {syncState.failedCount > 0 && (
            <button
              type="button"
              onClick={onRetrySaves}
              className="pressable rounded-lg border border-red-500/30 px-4 py-2 text-sm font-medium text-red-500"
            >
              {syncState.blockedCount > 0
                ? "Discard unsavable and continue"
                : "Retry saving"}
            </button>
          )}
        </div>
      )}
      {!syncState.persistenceAvailable && savesPending && (
        <p role="alert" className="max-w-sm text-sm text-amber-600 dark:text-amber-400">
          This browser could not store pending reviews. Keep this page open until saving
          finishes.
        </p>
      )}
      <div
        className="text-5xl font-bold tabular-nums"
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
        className="pressable min-h-14 w-full max-w-xs rounded-2xl bg-accent text-lg font-semibold text-accent-foreground disabled:opacity-40"
      >
        {!done ? "Resting…" : savesPending ? "Waiting for reviews to save…" : "Continue"}
      </button>
      <Link href={backHref} className="pressable rounded-lg px-3 py-2 text-sm text-muted">
        ← Back to deck
      </Link>
    </div>
  );
}
