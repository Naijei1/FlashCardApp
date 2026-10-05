"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { formatCountdown } from "@/lib/study-break";
import { plural } from "@/lib/plural";
import BreakScreen from "./BreakScreen";
import type { ReviewSyncState } from "./reviewSync";
import SyncNotice from "./SyncNotice";
import type { useStudyQueue } from "./useStudyQueue";

type StudyQueueState = ReturnType<typeof useStudyQueue>;

export function SessionScreen({
  backHref,
  title,
  body,
  syncState,
  onRetrySaves,
  onRetry,
}: {
  backHref: string;
  title: string;
  body: string;
  syncState: ReviewSyncState;
  onRetrySaves: () => void;
  onRetry?: () => void;
}) {
  return (
    <div className="mx-auto flex h-dvh max-w-md flex-col items-center justify-center gap-3 px-6 pb-safe text-center">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-muted">{body}</p>
      <SyncNotice state={syncState} onRetry={onRetrySaves} />
      {onRetry && (
        <button type="button" onClick={onRetry} className="btn btn-primary mt-2">
          Try again
        </button>
      )}
      <Link href={backHref} className={onRetry ? "btn btn-ghost" : "btn btn-primary mt-2"}>
        ← Back
      </Link>
    </div>
  );
}

/**
 * Everything a scheduled session shows when no card is ready: errors, breaks,
 * loading, completion, and waiting for a learning step. Null means "show the card".
 */
export function QueueStatus({
  study,
  backHref,
  copy,
}: {
  study: StudyQueueState;
  backHref: string;
  copy: { noun: string; verb: string; empty: string };
}) {
  const { queue, syncState, resolveSyncFailures, reviewed } = study;
  const screen = (title: string, body: string, onRetry?: () => void) => (
    <SessionScreen backHref={backHref} title={title} body={body} syncState={syncState}
      onRetrySaves={resolveSyncFailures} onRetry={onRetry} />
  );
  if (study.loadError) return screen("Something went wrong", `Could not load the ${copy.noun} queue.`, study.loadQueue);
  if (study.breakUntil > 0 && (queue === null || queue.length === 0)) {
    return (
      <BreakScreen
        until={study.breakUntil}
        reviewed={reviewed}
        waiting={reviewed > 0 ? study.waiting : null}
        syncState={syncState}
        scope={study.breakScope}
        backHref={backHref}
        onRetrySaves={resolveSyncFailures}
        onContinue={study.continueAfterBreak}
      />
    );
  }
  if (queue === null) {
    return screen("Loading…", syncState.pendingCount > 0
      ? "Finishing pending reviews before refreshing the queue."
      : `Preparing your ${copy.noun} queue.`);
  }
  if (queue.length === 0) {
    const title = reviewed === 0 ? "Nothing due"
      : syncState.failedCount > 0 ? "Reviews need attention"
        : syncState.pendingCount > 0 ? "Saving reviews…" : "Session complete";
    return screen(title, reviewed > 0 ? `You ${copy.verb} ${plural(reviewed, "card")}.` : copy.empty);
  }
  if (!study.current && study.nextDueAt !== null) {
    return screen("Next card is still learning",
      `Ready in ${formatCountdown(study.nextDueAt - study.nowMs)}. It will appear automatically when it is due.`);
  }
  return null;
}

export function SessionHeader({
  backHref,
  study,
  action,
}: {
  backHref: string;
  study: StudyQueueState;
  action?: ReactNode;
}) {
  const left = study.queue?.length ?? 0;
  const progress = left + study.reviewed > 0 ? study.reviewed / (left + study.reviewed) : 0;
  return (
    <>
      <header className="flex items-center gap-3 py-3">
        <Link href={backHref} className="btn btn-ghost -ml-2 shrink-0 px-3">
          ← Back
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex justify-between text-xs tabular-nums text-muted">
            <span>{left} left{study.waiting > 0 ? ` · ${study.waiting} waiting` : ""}</span>
            <span>{study.reviewed} done</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-border/70" aria-hidden="true">
            <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${progress * 100}%` }} />
          </div>
        </div>
        {action}
      </header>
      <SyncNotice state={study.syncState} onRetry={study.resolveSyncFailures} compact />
    </>
  );
}
