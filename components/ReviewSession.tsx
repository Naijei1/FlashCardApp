"use client";
import HardWordButton from "./HardWordButton";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { rateCard } from "@/lib/practice";
import type { Card } from "@/lib/types";
import {
  previewIntervals,
  type Grade,
  type IntervalPreview,
} from "@/lib/fsrs";
import { DEFAULT_BACK_LANG, DEFAULT_FRONT_LANG } from "@/lib/languages";
import {
  belongsInCurrentSession,
  canAcceptRating,
  firstReadyIndex,
  nextQueuedDue,
} from "@/lib/session-scheduling";
import { formatCountdown, getBreakUntil, startBreak } from "@/lib/study-break";
import BreakScreen from "./BreakScreen";
import RatingBar from "./RatingBar";
import { createReviewSync, type ReviewSyncState } from "./reviewSync";
import TtsButton from "./TtsButton";
import { useKeyboard } from "./useKeyboard";

export type ReviewQueueItem = { card: Card; intervals: IntervalPreview };
export type ReviewSessionData = {
  queue: ReviewQueueItem[];
  totalDue: number;
};
type QueueItem = ReviewQueueItem;
type DeckLangs = Record<string, { front?: string; back?: string }>;

const INITIAL_SYNC_STATE: ReviewSyncState = {
  pendingCount: 0,
  failedCount: 0,
  blockedCount: 0,
  isSyncing: false,
  persistenceAvailable: true,
};

export default function ReviewSession({
  deckId,
  deckLangs,
  backHref,
  newOnly = false,
}: {
  deckId: string;
  deckLangs: DeckLangs;
  backHref: string;
  newOnly?: boolean;
}) {
  // Client storage can contain a pending review or enforced break that the
  // server cannot see. Gate the first card until that local check completes.
  const [queue, setQueue] = useState<QueueItem[] | null>(null);
  const [totalDue, setTotalDue] = useState(0);
  const [batchSize, setBatchSize] = useState(0);
  const [breakUntil, setBreakUntil] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const [syncState, setSyncState] = useState<ReviewSyncState>(INITIAL_SYNC_STATE);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const advancedAtRef = useRef<number | null>(null);
  const loadAbortRef = useRef<AbortController | null>(null);
  const syncPendingRef = useRef<number | null>(null);
  const waitingToLoadRef = useRef(false);
  const sync = useMemo(
    () =>
      createReviewSync((failedCount) =>
        setSyncState((state) => ({ ...state, failedCount }))
      ),
    []
  );
  const breakScope = useMemo(() => ({ deckId, mode: "review" as const }), [deckId]);
  const resolveSyncFailures = useCallback(() => {
    sync.discardBlocked();
    sync.retryFailed();
  }, [sync]);

  const applyQueueData = useCallback((data: ReviewSessionData) => {
    setNowMs(Date.now());
    setQueue(data.queue);
    setTotalDue(data.totalDue);
    setBatchSize(data.queue.length);
  }, []);

  const loadQueue = useCallback(() => {
    loadAbortRef.current?.abort();
    const syncSnapshot = sync.getState();
    syncPendingRef.current = syncSnapshot.pendingCount;
    if (syncSnapshot.pendingCount > 0) {
      waitingToLoadRef.current = true;
      setLoadError(false);
      setQueue(null);
      return;
    }
    waitingToLoadRef.current = false;
    const controller = new AbortController();
    loadAbortRef.current = controller;
    setLoadError(false);
    setQueue(null);
    fetch(`/api/review/queue?deckId=${encodeURIComponent(deckId)}${newOnly ? "&new=1" : ""}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: { queue: QueueItem[]; totalDue: number }) => {
        if (controller.signal.aborted) return;
        applyQueueData(data);
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadError(true);
      });
  }, [applyQueueData, deckId, sync, newOnly]);

  useEffect(() => {
    const update = (state: ReviewSyncState) => {
      syncPendingRef.current = state.pendingCount;
      setSyncState(state);
    };
    const snapshot = sync.getState();
    syncPendingRef.current = snapshot.pendingCount;
    const unsubscribe = sync.subscribe(update);
    return () => {
      unsubscribe();
      sync.dispose();
    };
  }, [sync]);

  useEffect(() => {
    setBreakUntil(0);
    setReviewed(0);
    setRevealed(false);
    setTotalDue(0);
    setBatchSize(0);
    advancedAtRef.current = null;
    // Always fetch a fresh queue after local saves drain. Navigation can reuse
    // server-rendered pages containing cards that have already been reviewed.
    // An unfinished break (even across a reload) blocks the next batch.
    const until = getBreakUntil(breakScope);
    if (until > 0) {
      waitingToLoadRef.current = false;
      setBreakUntil(until);
      setQueue([]);
    } else if ((syncPendingRef.current ?? sync.getState().pendingCount) > 0) {
      // Loading from the server while restored reviews are still pending can
      // bring already-rated cards back into the queue.
      waitingToLoadRef.current = true;
      setQueue(null);
    } else {
      loadQueue();
    }
    return () => loadAbortRef.current?.abort();
  }, [breakScope, loadQueue, sync]);

  useEffect(() => {
    if (waitingToLoadRef.current && syncPendingRef.current === 0) loadQueue();
  }, [loadQueue, syncState.pendingCount]);

  const readyIndex = queue ? firstReadyIndex(queue, nowMs) : -1;
  const nextDueAt = queue && readyIndex < 0 ? nextQueuedDue(queue, nowMs) : null;

  useEffect(() => {
    if (nextDueAt === null) return;
    const delay = Math.max(25, Math.min(1000, nextDueAt - nowMs));
    const id = window.setTimeout(() => setNowMs(Date.now()), delay);
    return () => window.clearTimeout(id);
  }, [nextDueAt, nowMs]);

  const reveal = useCallback(() => {
    if (readyIndex >= 0) setRevealed(true);
  }, [readyIndex]);

  const rate = useCallback(
    (rating: number) => {
      if (!queue || readyIndex < 0 || !revealed) return;
      const advancedAt = performance.now();
      if (!canAcceptRating(advancedAtRef.current, advancedAt)) return;
      advancedAtRef.current = advancedAt;
      navigator.vibrate?.(10);

      const current = queue[readyIndex];
      // Persist in the background; advance instantly.
      const now = new Date();
      sync.push({ cardId: current.card.id, deckId: current.card.deckId, rating, reviewedAt: now.toISOString() });

      // Compute the new state locally just for the session queue: re-enqueue
      // cards that come back within this session's horizon. The server's
      // recomputation stays canonical for storage.
      const { fsrs, card: updatedCard } = rateCard(current.card, rating as Grade, now);
      const dueSoon = belongsInCurrentSession(fsrs.due, now.getTime());
      const rest = [...queue.slice(0, readyIndex), ...queue.slice(readyIndex + 1)];
      const next = dueSoon
        ? [
            ...rest,
            {
              card: updatedCard,
              intervals: previewIntervals(fsrs, new Date(fsrs.due)),
            },
          ]
        : rest;

      setReviewed((n) => n + 1);
      setRevealed(false);
      setNowMs(now.getTime());
      setQueue(next);
      if (next.length === 0 && totalDue > batchSize) {
        // Only start a break after every scheduled learning step in this batch.
        setBreakUntil(startBreak(breakScope, now.getTime()));
      }
    },
    [batchSize, breakScope, queue, readyIndex, revealed, sync, totalDue]
  );

  useKeyboard((event) => {
    if (event.key === " ") {
      event.preventDefault();
      if (revealed) rate(3);
      else reveal();
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (revealed) rate(3);
      else reveal();
    } else if (revealed && ["1", "2", "3", "4"].includes(event.key)) {
      event.preventDefault();
      rate(Number(event.key));
    }
  });

  if (loadError) {
    return (
      <Screen
        backHref={backHref}
        title="Something went wrong"
        body="Could not load the review queue."
        syncState={syncState}
        onRetrySaves={resolveSyncFailures}
        onRetry={loadQueue}
      />
    );
  }
  if (breakUntil > 0 && (queue === null || queue.length === 0)) {
    return (
      <BreakScreen
        until={breakUntil}
        reviewed={reviewed}
        waiting={reviewed > 0 ? Math.max(totalDue - batchSize, 0) : null}
        syncState={syncState}
        scope={breakScope}
        backHref={backHref}
        onRetrySaves={resolveSyncFailures}
        onContinue={() => {
          setBreakUntil(0);
          setReviewed(0);
          advancedAtRef.current = null;
          loadQueue();
        }}
      />
    );
  }
  if (queue === null) {
    return (
      <Screen
        backHref={backHref}
        title="Loading…"
        body={
          syncState.pendingCount > 0
            ? "Finishing pending reviews before refreshing the queue."
            : "Preparing your review queue."
        }
        syncState={syncState}
        onRetrySaves={resolveSyncFailures}
      />
    );
  }
  if (queue.length === 0) {
    return (
      <Screen
        backHref={backHref}
        title={
          reviewed === 0
            ? "Nothing due"
            : syncState.failedCount > 0
              ? "Reviews need attention"
              : syncState.pendingCount > 0
                ? "Saving reviews…"
                : "Session complete"
        }
        body={
          reviewed > 0
            ? `You reviewed ${reviewed} card${reviewed === 1 ? "" : "s"}.`
            : newOnly ? "No unseen words are due in this deck. Use Spaced Repetition for words you have already started." : "No cards are due right now — come back later."
        }
        syncState={syncState}
        onRetrySaves={resolveSyncFailures}
      />
    );
  }

  if (readyIndex < 0 && nextDueAt !== null) {
    return (
      <Screen
        backHref={backHref}
        title="Next card is still learning"
        body={`Ready in ${formatCountdown(nextDueAt - nowMs)}. It will appear automatically when it is due.`}
        syncState={syncState}
        onRetrySaves={resolveSyncFailures}
      />
    );
  }

  const { card } = queue[readyIndex];
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

      <SyncNotice
        state={syncState}
        onRetry={resolveSyncFailures}
        compact
      />

      <HardWordButton key={`${card.deckId}:${card.id}`} card={card}
        onChange={(hard) => setQueue((items) => items?.map((item) => item.card.id === card.id && item.card.deckId === card.deckId
          ? { ...item, card: { ...item.card, hard } } : item) ?? null)} />
      {/* Tap anywhere on the card to reveal; two fixed halves so nothing jumps. */}
      <div
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
          <RatingBar fsrs={card.fsrs} onRate={rate} />
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

function SyncNotice({
  state,
  onRetry,
  compact = false,
}: {
  state: ReviewSyncState;
  onRetry: () => void;
  compact?: boolean;
}) {
  if (state.pendingCount === 0) return null;
  return (
    <div className={`flex flex-col items-center gap-2 ${compact ? "mb-2 text-xs" : "text-sm"}`}>
      {state.pendingCount > 0 && (
        <p
          role={state.failedCount > 0 ? "alert" : undefined}
          className={`rounded-lg px-3 py-2 text-center ${
            state.failedCount > 0 ? "bg-red-500/10 text-red-500" : "text-muted"
          }`}
        >
          {state.blockedCount > 0
            ? `${state.blockedCount} review${state.blockedCount === 1 ? "" : "s"} cannot be saved because the card changed or was removed. Discard to continue.`
            : state.failedCount > 0
              ? `${state.failedCount} review${state.failedCount === 1 ? "" : "s"} still need to be saved.`
            : `Saving ${state.pendingCount} review${state.pendingCount === 1 ? "" : "s"}…`}
        </p>
      )}
      {state.failedCount > 0 && (
        <button
          type="button"
          onClick={onRetry}
          className="pressable rounded-lg border border-red-500/30 px-4 py-2 font-medium text-red-500"
        >
          {state.blockedCount > 0 ? "Discard unsavable and continue" : "Retry saving"}
        </button>
      )}
      {!state.persistenceAvailable && (
        <p role="alert" className="max-w-sm text-center text-amber-600 dark:text-amber-400">
          This browser could not store pending reviews. Keep this page open until saving
          finishes.
        </p>
      )}
    </div>
  );
}

function Screen({
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
    <div className="flex h-dvh flex-col items-center justify-center gap-3 px-6 pb-safe text-center">
      {title && <h1 className="text-xl font-semibold">{title}</h1>}
      {body && <p className="text-muted">{body}</p>}
      <SyncNotice state={syncState} onRetry={onRetrySaves} />
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="pressable mt-2 min-h-12 rounded-xl bg-accent px-5 py-3 font-medium text-accent-foreground"
        >
          Try again
        </button>
      )}
      <Link
        href={backHref}
        className={`pressable rounded-xl px-5 py-3 font-medium ${
          onRetry ? "text-muted" : "mt-2 bg-accent text-accent-foreground"
        }`}
      >
        ← Back
      </Link>
    </div>
  );
}
