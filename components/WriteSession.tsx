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
import {
  belongsInCurrentSession,
  canAcceptRating,
  firstReadyIndex,
  nextQueuedDue,
} from "@/lib/session-scheduling";
import { formatCountdown, getBreakUntil, startBreak } from "@/lib/study-break";
import BreakScreen from "./BreakScreen";
import { IconCheck, IconX } from "./icons";
import RatingBar from "./RatingBar";
import { createReviewSync, type ReviewSyncState } from "./reviewSync";
import TtsButton from "./TtsButton";
import { useKeyboard } from "./useKeyboard";

export type WriteQueueItem = { card: Card; intervals: IntervalPreview };
export type WriteSessionInitialData = {
  queue: WriteQueueItem[];
  totalDue: number;
};
type QueueItem = WriteQueueItem;

const INITIAL_SYNC_STATE: ReviewSyncState = {
  pendingCount: 0,
  failedCount: 0,
  blockedCount: 0,
  isSyncing: false,
  persistenceAvailable: true,
};

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
  initialData,
}: {
  deckId: string;
  /** Deck-level fallback; each card's side is detected from its own text. */
  deckSide: ChineseSide | null;
  chineseLang: string;
  backHref: string;
  initialData?: WriteSessionInitialData;
}) {
  // Client storage can contain a pending review or enforced break that the
  // server cannot see. Gate the first card until that local check completes.
  const [queue, setQueue] = useState<QueueItem[] | null>(null);
  const [totalDue, setTotalDue] = useState(0);
  const [batchSize, setBatchSize] = useState(0);
  const [breakUntil, setBreakUntil] = useState(0);
  const [value, setValue] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [reviewed, setReviewed] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const [syncState, setSyncState] = useState<ReviewSyncState>(INITIAL_SYNC_STATE);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const inputRef = useRef<HTMLInputElement>(null);
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
  const breakScope = useMemo(() => ({ deckId, mode: "write" as const }), [deckId]);
  const resolveSyncFailures = useCallback(() => {
    sync.discardBlocked();
    sync.retryFailed();
  }, [sync]);

  const applyQueueData = useCallback(
    (data: WriteSessionInitialData) => {
      const usable = data.queue.filter(
        (item) => chineseSideForCard(item.card, deckSide) !== null
      );
      setNowMs(Date.now());
      setQueue(usable);
      setTotalDue(data.totalDue);
      // The batch boundary comes from the server, not the write-compatible subset.
      setBatchSize(data.queue.length);
    },
    [deckSide]
  );

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
    fetch(`/api/review/queue?deckId=${encodeURIComponent(deckId)}&mode=write`, {
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: { queue: QueueItem[]; totalDue: number }) => {
        if (controller.signal.aborted) return;
        applyQueueData(data);
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadError(true);
      });
  }, [applyQueueData, deckId, sync]);

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
    setResult(null);
    setValue("");
    setTotalDue(0);
    setBatchSize(0);
    advancedAtRef.current = null;
    // An unfinished break (even across a reload) blocks the next batch.
    const until = getBreakUntil(breakScope);
    if (until > 0) {
      waitingToLoadRef.current = false;
      setBreakUntil(until);
      setQueue([]);
    } else if ((syncPendingRef.current ?? sync.getState().pendingCount) > 0) {
      // Do not refresh from canonical storage until locally restored reviews
      // have drained, or already-rated cards can reappear.
      waitingToLoadRef.current = true;
      setQueue(null);
    } else if (initialData) {
      waitingToLoadRef.current = false;
      applyQueueData(initialData);
    } else {
      loadQueue();
    }
    return () => loadAbortRef.current?.abort();
  }, [applyQueueData, breakScope, initialData, loadQueue, sync]);

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

  const current = queue && readyIndex >= 0 ? queue[readyIndex] : undefined;
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
      if (!queue || readyIndex < 0 || !result) return;
      const advancedAt = performance.now();
      if (!canAcceptRating(advancedAtRef.current, advancedAt)) return;
      advancedAtRef.current = advancedAt;
      navigator.vibrate?.(10);

      const item = queue[readyIndex];
      sync.push({ cardId: item.card.id, deckId: item.card.deckId, rating });

      const now = new Date();
      const { fsrs } = applyRating(item.card.fsrs, rating as Grade, now);
      const dueSoon = belongsInCurrentSession(fsrs.due, now.getTime());
      const rest = [...queue.slice(0, readyIndex), ...queue.slice(readyIndex + 1)];
      const next = dueSoon
        ? [
            ...rest,
            {
              card: { ...item.card, fsrs },
              intervals: previewIntervals(fsrs, new Date(fsrs.due)),
            },
          ]
        : rest;

      setReviewed((n) => n + 1);
      setResult(null);
      setValue("");
      setNowMs(now.getTime());
      setQueue(next);
      if (next.length === 0 && totalDue > batchSize) {
        // Only start a break after every scheduled learning step in this batch.
        setBreakUntil(startBreak(breakScope, now.getTime()));
      }
      // Called from a tap/keypress, so refocusing keeps the keyboard up on iOS.
      if (firstReadyIndex(next, now.getTime()) >= 0) inputRef.current?.focus();
    },
    [batchSize, breakScope, queue, readyIndex, result, sync, totalDue]
  );

  const defaultRating = result ? (result.correct ? 3 : 1) : 3;

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    // Never treat the Enter that confirms a pinyin/IME candidate as a submit.
    if (
      event.defaultPrevented ||
      event.repeat ||
      event.nativeEvent.isComposing ||
      event.keyCode === 229
    ) {
      return;
    }
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
    if (event.key === "Enter") {
      event.preventDefault();
      rate(defaultRating);
    } else if (["1", "2", "3", "4"].includes(event.key)) {
      event.preventDefault();
      rate(Number(event.key));
    }
  });

  if (loadError) {
    return (
      <Screen
        backHref={backHref}
        title="Something went wrong"
        body="Could not load the writing queue."
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
            : "Preparing your writing queue."
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
            ? `You wrote ${reviewed} card${reviewed === 1 ? "" : "s"}.`
            : "No writable cards are due right now — come back later."
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

  if (!current || !prompt) {
    return (
      <Screen
        backHref={backHref}
        title="Nothing writable"
        body="No cards in this batch have a Chinese answer to write."
        syncState={syncState}
        onRetrySaves={resolveSyncFailures}
      />
    );
  }

  return (
    <div className="study-surface mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-4 pb-safe">
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
                <p className="flex items-center gap-1.5 text-lg font-medium text-green-600 dark:text-green-400">
                  <IconCheck strokeWidth={2.5} /> Correct
                </p>
              ) : (
                <>
                  <p className="flex items-center gap-1.5 text-lg font-medium text-red-500">
                    <IconX strokeWidth={2.5} /> Incorrect
                  </p>
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
