"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { rateCard } from "@/lib/practice";
import type { MistakeClinicQueueItem } from "@/lib/mistake-clinic-queue";
import type { Card } from "@/lib/types";
import { wordKey } from "@/lib/words";
import { createReviewSync, type ReviewSyncState } from "./reviewSync";

const INITIAL_SYNC_STATE: ReviewSyncState = {
  pendingCount: 0,
  failedCount: 0,
  blockedCount: 0,
  isSyncing: false,
  persistenceAvailable: true,
};

export function useMistakeClinicQueue() {
  const [queue, setQueue] = useState<MistakeClinicQueueItem[] | null>(null);
  const [totalWeak, setTotalWeak] = useState(0);
  const [reviewed, setReviewed] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const [syncState, setSyncState] = useState<ReviewSyncState>(INITIAL_SYNC_STATE);
  const loadAbortRef = useRef<AbortController | null>(null);
  const waitingToLoadRef = useRef(false);
  const syncPendingRef = useRef<number | null>(null);
  const advancedAtRef = useRef<number | null>(null);
  const sync = useMemo(
    () => createReviewSync((failedCount) => setSyncState((state) => ({ ...state, failedCount }))),
    []
  );

  const resolveSyncFailures = useCallback(() => {
    sync.discardBlocked();
    sync.retryFailed();
  }, [sync]);

  const loadQueue = useCallback(() => {
    loadAbortRef.current?.abort();
    const snapshot = sync.getState();
    syncPendingRef.current = snapshot.pendingCount;
    setLoadError(false);
    setQueue(null);
    if (snapshot.pendingCount > 0) {
      waitingToLoadRef.current = true;
      return;
    }
    waitingToLoadRef.current = false;
    const controller = new AbortController();
    loadAbortRef.current = controller;
    fetch("/api/mistake-clinic/queue", { signal: controller.signal, cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: { queue: MistakeClinicQueueItem[]; totalWeak: number }) => {
        if (controller.signal.aborted) return;
        setQueue(data.queue);
        setTotalWeak(data.totalWeak);
        setReviewed(0);
        advancedAtRef.current = null;
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadError(true);
      });
  }, [sync]);

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
    loadQueue();
    return () => loadAbortRef.current?.abort();
  }, [loadQueue]);

  useEffect(() => {
    if (waitingToLoadRef.current && syncPendingRef.current === 0) loadQueue();
  }, [loadQueue, syncState.pendingCount]);

  const submitRating = useCallback(
    (rating: number): MistakeClinicQueueItem[] | null => {
      if (!queue?.length) return null;
      const advancedAt = performance.now();
      if (advancedAtRef.current !== null && advancedAt - advancedAtRef.current < 350) return null;
      advancedAtRef.current = advancedAt;
      navigator.vibrate?.(10);

      const [item, ...rest] = queue;
      const now = new Date();
      sync.push({
        mode: item.mode,
        cardId: item.card.id,
        deckId: item.card.deckId,
        rating,
        reviewedAt: now.toISOString(),
      });
      const { card } = rateCard(item.card, rating as 1 | 2 | 3 | 4, now, item.mode);
      const next = rest.map((queued) =>
        queued.card.id === item.card.id && queued.card.deckId === item.card.deckId && queued.mode === item.mode
          ? { ...queued, card }
          : queued
      );
      setQueue(next);
      setReviewed((count) => count + 1);
      return next;
    },
    [queue, sync]
  );

  const setHard = useCallback((target: Card, hard: boolean) => {
    const key = wordKey(target);
    setQueue((items) => items?.map((item) =>
      wordKey(item.card) === key ? { ...item, card: { ...item.card, hard } } : item
    ) ?? null);
  }, []);

  return {
    queue,
    current: queue?.[0],
    totalWeak,
    reviewed,
    loadError,
    syncState,
    loadQueue,
    resolveSyncFailures,
    submitRating,
    setHard,
  };
}
