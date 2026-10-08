"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { rateCard } from "@/lib/practice";
import type { MistakeClinicQueueItem } from "@/lib/mistake-clinic-queue";
import { pickIndex, studyItemKey } from "@/lib/session-scheduling";
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

const clinicItemKey = (item: MistakeClinicQueueItem) => `${studyItemKey(item)}\u0000${item.mode}`;

export function useMistakeClinicQueue({ random = Math.random }: { random?: () => number } = {}) {
  const [queue, setQueue] = useState<MistakeClinicQueueItem[] | null>(null);
  const [totalWeak, setTotalWeak] = useState(0);
  const [reviewed, setReviewed] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const [syncState, setSyncState] = useState<ReviewSyncState>(INITIAL_SYNC_STATE);
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const loadAbortRef = useRef<AbortController | null>(null);
  const waitingToLoadRef = useRef(false);
  const syncPendingRef = useRef<number | null>(null);
  const advancedAtRef = useRef<number | null>(null);
  const currentKeyRef = useRef<string | null>(null);
  const lastShownKeyRef = useRef<string | null>(null);
  const randomRef = useRef(random);
  randomRef.current = random;
  const sync = useMemo(
    () => createReviewSync((failedCount) => setSyncState((state) => ({ ...state, failedCount }))),
    []
  );

  const chooseCurrent = useCallback((items: MistakeClinicQueueItem[], avoidKey: string | null) => {
    const index = pickIndex(items, items.map((_, i) => i), {
      random: randomRef.current,
      avoidKey,
      keyOf: studyItemKey,
    });
    const key = index >= 0 ? clinicItemKey(items[index]) : null;
    currentKeyRef.current = key;
    setCurrentKey(key);
    return index;
  }, []);

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
    currentKeyRef.current = null;
    lastShownKeyRef.current = null;
    setCurrentKey(null);
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
        chooseCurrent(data.queue, null);
        setQueue(data.queue);
        setTotalWeak(data.totalWeak);
        setReviewed(0);
        advancedAtRef.current = null;
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadError(true);
      });
  }, [chooseCurrent, sync]);

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

  const readyIndex = queue && currentKey
    ? queue.findIndex((item) => clinicItemKey(item) === currentKey)
    : -1;

  useEffect(() => {
    if (!queue) return;
    if (currentKey && queue.some((item) => clinicItemKey(item) === currentKey)) return;
    chooseCurrent(queue, lastShownKeyRef.current);
  }, [chooseCurrent, currentKey, queue]);

  const submitRating = useCallback(
    (rating: number): MistakeClinicQueueItem[] | null => {
      if (!queue || readyIndex < 0) return null;
      const advancedAt = performance.now();
      if (advancedAtRef.current !== null && advancedAt - advancedAtRef.current < 350) return null;
      advancedAtRef.current = advancedAt;
      navigator.vibrate?.(10);

      const item = queue[readyIndex];
      const now = new Date();
      sync.push({
        mode: item.mode,
        cardId: item.card.id,
        deckId: item.card.deckId,
        rating,
        reviewedAt: now.toISOString(),
      });
      const { card } = rateCard(item.card, rating as 1 | 2 | 3 | 4, now, item.mode);
      const rest = [...queue.slice(0, readyIndex), ...queue.slice(readyIndex + 1)];
      const next = rest.map((queued) =>
        queued.card.id === item.card.id && queued.card.deckId === item.card.deckId && queued.mode === item.mode
          ? { ...queued, card }
          : queued
      );
      lastShownKeyRef.current = studyItemKey(item);
      chooseCurrent(next, lastShownKeyRef.current);
      setQueue(next);
      setReviewed((count) => count + 1);
      return next;
    },
    [chooseCurrent, queue, readyIndex, sync]
  );

  const setHard = useCallback((target: Card, hard: boolean) => {
    const key = wordKey(target);
    setQueue((items) => items?.map((item) =>
      wordKey(item.card) === key ? { ...item, card: { ...item.card, hard } } : item
    ) ?? null);
  }, []);

  return {
    queue,
    current: queue && readyIndex >= 0 ? queue[readyIndex] : undefined,
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
