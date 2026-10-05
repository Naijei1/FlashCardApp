"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Grade } from "@/lib/fsrs";
import { rateCard } from "@/lib/practice";
import type { StudyQueueItem } from "@/lib/review-queue";
import {
  belongsInCurrentSession,
  canAcceptRating,
  firstReadyIndex,
  nextQueuedDue,
} from "@/lib/session-scheduling";
import { getBreakUntil, startBreak } from "@/lib/study-break";
import type { Card, ReviewMode } from "@/lib/types";
import { createReviewSync, type ReviewSyncState } from "./reviewSync";

const INITIAL_SYNC_STATE: ReviewSyncState = {
  pendingCount: 0,
  failedCount: 0,
  blockedCount: 0,
  isSyncing: false,
  persistenceAvailable: true,
};

/**
 * Shared queue lifecycle for every scheduled study mode: loading, durable
 * background saves, in-session learning steps, and enforced batch breaks.
 */
export function useStudyQueue({
  deckId,
  mode,
  newOnly = false,
}: {
  deckId: string;
  mode: ReviewMode;
  newOnly?: boolean;
}) {
  // Client storage can contain a pending review or enforced break that the
  // server cannot see. Gate the first card until that local check completes.
  const [queue, setQueue] = useState<StudyQueueItem[] | null>(null);
  const [totalDue, setTotalDue] = useState(0);
  const [batchSize, setBatchSize] = useState(0);
  const [breakUntil, setBreakUntil] = useState(0);
  const [reviewed, setReviewed] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const [syncState, setSyncState] = useState<ReviewSyncState>(INITIAL_SYNC_STATE);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const advancedAtRef = useRef<number | null>(null);
  const loadAbortRef = useRef<AbortController | null>(null);
  const syncPendingRef = useRef<number | null>(null);
  const waitingToLoadRef = useRef(false);
  const sync = useMemo(
    () => createReviewSync((failedCount) => setSyncState((state) => ({ ...state, failedCount }))),
    []
  );
  const breakScope = useMemo(() => ({ deckId, mode }), [deckId, mode]);

  const resolveSyncFailures = useCallback(() => {
    sync.discardBlocked();
    sync.retryFailed();
  }, [sync]);

  const loadQueue = useCallback(() => {
    loadAbortRef.current?.abort();
    const syncSnapshot = sync.getState();
    syncPendingRef.current = syncSnapshot.pendingCount;
    setLoadError(false);
    setQueue(null);
    if (syncSnapshot.pendingCount > 0) {
      // Loading while restored reviews are pending can bring rated cards back.
      waitingToLoadRef.current = true;
      return;
    }
    waitingToLoadRef.current = false;
    const controller = new AbortController();
    loadAbortRef.current = controller;
    const params = new URLSearchParams({ deckId, mode });
    if (newOnly) params.set("new", "1");
    fetch(`/api/review/queue?${params}`, { signal: controller.signal, cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: { queue: StudyQueueItem[]; totalDue: number }) => {
        if (controller.signal.aborted) return;
        setNowMs(Date.now());
        setQueue(data.queue);
        setTotalDue(data.totalDue);
        setBatchSize(data.queue.length);
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadError(true);
      });
  }, [deckId, mode, newOnly, sync]);

  useEffect(() => {
    const unsubscribe = sync.subscribe((state) => {
      syncPendingRef.current = state.pendingCount;
      setSyncState(state);
    });
    syncPendingRef.current = sync.getState().pendingCount;
    return () => {
      unsubscribe();
      sync.dispose();
    };
  }, [sync]);

  useEffect(() => {
    setBreakUntil(0);
    setReviewed(0);
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
    } else {
      loadQueue();
    }
    return () => loadAbortRef.current?.abort();
  }, [breakScope, loadQueue]);

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

  /** Saves a rating in the background and returns the next queue, or null if ignored. */
  const submitRating = useCallback(
    (rating: number): StudyQueueItem[] | null => {
      if (!queue || readyIndex < 0) return null;
      const advancedAt = performance.now();
      if (!canAcceptRating(advancedAtRef.current, advancedAt)) return null;
      advancedAtRef.current = advancedAt;
      navigator.vibrate?.(10);

      const item = queue[readyIndex];
      const now = new Date();
      sync.push({ mode, cardId: item.card.id, deckId: item.card.deckId, rating, reviewedAt: now.toISOString() });
      // The local result only decides whether a learning step returns within
      // this session; the server's recomputation stays canonical for storage.
      const { card } = rateCard(item.card, rating as Grade, now);
      const rest = [...queue.slice(0, readyIndex), ...queue.slice(readyIndex + 1)];
      const next = belongsInCurrentSession(card.fsrs.due, now.getTime())
        ? [...rest, { ...item, card }]
        : rest;
      setReviewed((n) => n + 1);
      setNowMs(now.getTime());
      setQueue(next);
      if (next.length === 0 && totalDue > batchSize) {
        // Only start a break after every scheduled learning step in this batch.
        setBreakUntil(startBreak(breakScope, now.getTime()));
      }
      return next;
    },
    [batchSize, breakScope, mode, queue, readyIndex, sync, totalDue]
  );

  const setHard = useCallback((target: Card, hard: boolean) => {
    setQueue((items) => items?.map((item) =>
      item.card.id === target.id && item.card.deckId === target.deckId
        ? { ...item, card: { ...item.card, hard } }
        : item
    ) ?? null);
  }, []);

  const continueAfterBreak = useCallback(() => {
    setBreakUntil(0);
    setReviewed(0);
    advancedAtRef.current = null;
    loadQueue();
  }, [loadQueue]);

  return {
    queue,
    current: queue && readyIndex >= 0 ? queue[readyIndex] : undefined,
    nextDueAt,
    nowMs,
    totalDue,
    batchSize,
    waiting: Math.max(totalDue - batchSize, 0),
    breakUntil,
    breakScope,
    reviewed,
    loadError,
    syncState,
    loadQueue,
    resolveSyncFailures,
    submitRating,
    setHard,
    continueAfterBreak,
  };
}
