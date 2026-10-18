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
  note,
  backLabel = "← Back",
  action,
}: {
  backHref: string;
  title: string;
  body: string;
  syncState: ReviewSyncState;
  onRetrySaves: () => void;
  onRetry?: () => void;
  note?: string;
  backLabel?: string;
  action?: ReactNode;
}) {
  const secondaryBack = !!(onRetry || action);
  return (
    <div className="study-frame mx-auto flex max-w-md flex-col items-center justify-center gap-3 px-6 pt-safe pb-safe text-center">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-muted">{body}</p>
      {note && <BackLaterNote text={note} />}
      <SyncNotice state={syncState} onRetry={onRetrySaves} />
      {onRetry && (
        <button type="button" onClick={onRetry} className="btn btn-primary mt-2">
          Try again
        </button>
      )}
      {action}
      <Link href={backHref} className={secondaryBack ? "btn btn-ghost" : "btn btn-primary mt-2"}>
        {backLabel}
      </Link>
    </div>
  );
}

function BackLaterNote({ text }: { text: string }) {
  return (
    <p role="status" className="rounded-full bg-accent/10 px-3 py-1 text-sm font-medium text-accent">
      ↻ {text}
    </p>
  );
}

/** Learning cards that left the session for their ~1h step. */
function backLaterText(count: number): string | undefined {
  if (count === 0) return undefined;
  return `${plural(count, "word")} ${count === 1 ? "comes" : "come"} back in about an hour`;
}

/**
 * Everything a scheduled session shows when no card is ready: errors, breaks,
 * loading, completion, and waiting for a learning step. Null means "show the card".
 */
export function QueueStatus({
  study,
  backHref,
  copy,
  onLearnMore,
}: {
  study: StudyQueueState;
  backHref: string;
  copy: { noun: string; verb: string; empty: string };
  onLearnMore?: () => void;
}) {
  const { queue, syncState, resolveSyncFailures, reviewed } = study;
  const note = backLaterText(study.backLater);
  const screen = (title: string, body: string, onRetry?: () => void, backLabel?: string, action?: ReactNode) => (
    <SessionScreen backHref={backHref} title={title} body={body} syncState={syncState}
      onRetrySaves={resolveSyncFailures} onRetry={onRetry} note={note} backLabel={backLabel} action={action} />
  );
  if (study.loadError) return screen("Something went wrong", `Could not load the ${copy.noun} queue.`, study.loadQueue);
  if (study.breakUntil > 0) {
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
        note={note}
      />
    );
  }
  if (queue === null) {
    return screen("Loading…", syncState.pendingCount > 0
      ? "Finishing pending reviews before refreshing the queue."
      : `Preparing your ${copy.noun} queue.`);
  }
  if (queue.length === 0) {
    const canLearnMore = !!onLearnMore && study.remainingNew > 0;
    const title = reviewed === 0
      ? canLearnMore ? "Today's new words are done" : "Nothing due"
      : syncState.failedCount > 0 ? "Reviews need attention"
        : syncState.pendingCount > 0 ? "Saving reviews…" : "Session complete";
    const body = reviewed > 0
      ? `You ${copy.verb} ${plural(reviewed, "card")}.${
        canLearnMore ? " More new words are ready when you want them."
          : onLearnMore ? " No more new words left to start." : ""
      }`
      : canLearnMore
        ? "You've reached today's new-word limit for this skill. Learn more new words, or come back tomorrow."
        : copy.empty;
    const action = canLearnMore ? (
      <button type="button" onClick={onLearnMore} className="btn btn-primary mt-2">
        Learn more new words
      </button>
    ) : undefined;
    return screen(title, body, undefined, undefined, action);
  }
  if (!study.current && study.nextDueAt !== null) {
    // Nothing else is waiting, so the user may stay for the last steps or leave;
    // unfinished learning cards are saved and come first next session.
    return screen("Almost done",
      `${plural(queue.length, "word")} still learning — next one in ${formatCountdown(study.nextDueAt - study.nowMs)}. ` +
      "Stay and it appears automatically, or finish now and it comes first next time.",
      undefined, "Finish for now");
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
      {study.backLater > 0 && (
        <p className="-mt-1 mb-2 text-center text-xs text-muted">↻ {backLaterText(study.backLater)}</p>
      )}
      <SyncNotice state={study.syncState} onRetry={study.resolveSyncFailures} compact />
    </>
  );
}
