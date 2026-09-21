"use client";

// Reviews are persisted before the request starts, then drained in the
// background. The stable clientReviewId is both the local queue identity and
// the server idempotency key, so any request may be retried safely.

const LEGACY_STORAGE_KEY = "flashcards.pending-reviews.v1";
const STORAGE_KEY_PREFIX = "flashcards.pending-review.v2:";
// Every atomic review also updates the same exact stats counter. Serializing
// this background work avoids DynamoDB transaction conflicts without slowing
// the optimistic study UI.
const MAX_CONCURRENT_CARDS = 1;
const MAX_RETRY_DELAY_MS = 5 * 60_000;

export type PendingReview = {
  mode?: "review" | "write" | "pinyin";
  cardId: string;
  deckId: string;
  rating: number;
  /** Primarily useful to callers restoring their own queue. Usually omitted. */
  clientReviewId?: string;
  /** The time the user rated the card. Usually omitted. */
  reviewedAt?: string;
};

type QueuedReview = Required<PendingReview> & {
  attempts: number;
  failed: boolean;
  retryable: boolean;
  nextAttemptAt: number | null;
};

export type ReviewSyncState = {
  pendingCount: number;
  failedCount: number;
  blockedCount: number;
  isSyncing: boolean;
  persistenceAvailable: boolean;
};

type StateListener = (state: ReviewSyncState) => void;
type PostResult = { ok: true } | { ok: false; retryable: boolean };

function newClientReviewId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `review_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

function normalizeQueuedReview(value: unknown): QueuedReview | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<QueuedReview>;
  if (
    typeof item.cardId !== "string" ||
    !item.cardId ||
    typeof item.deckId !== "string" ||
    !item.deckId ||
    typeof item.rating !== "number" ||
    ![1, 2, 3, 4].includes(item.rating) ||
    typeof item.clientReviewId !== "string" ||
    !item.clientReviewId ||
    typeof item.reviewedAt !== "string" ||
    !Number.isFinite(Date.parse(item.reviewedAt))
  ) {
    return null;
  }
  return {
    mode: item.mode ?? "review",
    cardId: item.cardId,
    deckId: item.deckId,
    rating: item.rating,
    clientReviewId: item.clientReviewId,
    reviewedAt: new Date(item.reviewedAt).toISOString(),
    attempts:
      typeof item.attempts === "number" && Number.isSafeInteger(item.attempts)
        ? Math.max(item.attempts, 0)
        : 0,
    failed: item.failed === true,
    retryable: item.retryable !== false,
    nextAttemptAt:
      typeof item.nextAttemptAt === "number" && Number.isFinite(item.nextAttemptAt)
        ? item.nextAttemptAt
        : null,
  };
}

function isOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

function compareQueuedReviews(a: QueuedReview, b: QueuedReview): number {
  return (
    Date.parse(a.reviewedAt) - Date.parse(b.reviewedAt) ||
    a.clientReviewId.localeCompare(b.clientReviewId)
  );
}

class ReviewQueue {
  private queue: QueuedReview[] = [];
  private activeCards = new Set<string>();
  private listeners = new Set<StateListener>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private storage: Storage | null = null;
  private persistenceAvailable = false;

  constructor() {
    if (typeof window !== "undefined") {
      try {
        this.storage = window.localStorage;
        this.persistenceAvailable = true;
        this.readStorage();
        if (isOnline()) {
          const now = Date.now();
          for (const item of this.queue) {
            if (item.retryable && item.nextAttemptAt === null) {
              item.nextAttemptAt = now;
            }
          }
        }
      } catch {
        this.storage = null;
      }
      window.addEventListener("online", this.handleOnline);
      window.addEventListener("storage", this.handleStorage);
    }
    queueMicrotask(() => this.drain());
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    // createReviewSync is commonly called during render. Defer the initial
    // snapshot so a React state callback never runs while rendering.
    queueMicrotask(() => {
      if (this.listeners.has(listener)) listener(this.getState());
    });
    return () => this.listeners.delete(listener);
  }

  getState(): ReviewSyncState {
    return {
      pendingCount: this.queue.length,
      failedCount: this.queue.filter((item) => item.failed).length,
      blockedCount: this.queue.filter((item) => item.failed && !item.retryable).length,
      isSyncing: this.activeCards.size > 0,
      persistenceAvailable: this.persistenceAvailable,
    };
  }

  push(review: PendingReview): string {
    const reviewedAt = review.reviewedAt
      ? new Date(review.reviewedAt).toISOString()
      : new Date().toISOString();
    const offline = !isOnline();
    const queued: QueuedReview = {
      mode: review.mode ?? "review",
      cardId: review.cardId,
      deckId: review.deckId,
      rating: review.rating,
      clientReviewId: review.clientReviewId || newClientReviewId(),
      reviewedAt,
      attempts: 0,
      failed: offline,
      retryable: true,
      nextAttemptAt: offline ? null : Date.now(),
    };
    this.queue.push(queued);
    if (!this.writeItem(queued)) queued.failed = true;
    this.notify();
    this.drain();
    return queued.clientReviewId;
  }

  retryFailed(): void {
    const now = Date.now();
    for (const item of this.queue) {
      if (item.retryable) {
        item.nextAttemptAt = now;
        this.writeItem(item);
      }
    }
    this.notify();
    this.drain();
  }

  discardBlocked(): void {
    const blocked = this.queue.filter((item) => item.failed && !item.retryable);
    if (blocked.length === 0) return;
    const ids = new Set(blocked.map((item) => item.clientReviewId));
    this.queue = this.queue.filter((item) => !ids.has(item.clientReviewId));
    for (const item of blocked) this.removeItem(item.clientReviewId);
    this.notify();
    this.drain();
  }

  private cardKey(review: QueuedReview): string {
    return `${review.deckId}\u0000${review.cardId}`;
  }

  private readStorage(): void {
    if (!this.storage) return;
    try {
      const restored = new Map<string, QueuedReview>();
      for (let index = 0; index < this.storage.length; index++) {
        const key = this.storage.key(index);
        if (!key?.startsWith(STORAGE_KEY_PREFIX)) continue;
        const serialized = this.storage.getItem(key);
        if (!serialized) continue;
        try {
          const item = normalizeQueuedReview(JSON.parse(serialized));
          if (item) restored.set(item.clientReviewId, item);
        } catch {
          // Ignore only the malformed entry; other durable reviews still load.
        }
      }

      // Migrate the original all-items-in-one-key format. Individual keys make
      // additions/removals atomic across browser tabs instead of last-writer-wins.
      const legacy = this.storage.getItem(LEGACY_STORAGE_KEY);
      if (legacy) {
        try {
          const parsed: unknown = JSON.parse(legacy);
          if (Array.isArray(parsed)) {
            for (const value of parsed) {
              const item = normalizeQueuedReview(value);
              if (!item || restored.has(item.clientReviewId)) continue;
              restored.set(item.clientReviewId, item);
              this.writeItem(item);
            }
          }
        } catch {
          // A corrupt legacy blob must not hide valid v2 entries.
        }
        this.storage.removeItem(LEGACY_STORAGE_KEY);
      }
      this.queue = [...restored.values()].sort(compareQueuedReviews);
    } catch {
      // A malformed value should not prevent new reviews from syncing.
      this.queue = [];
    }
  }

  private writeItem(item: QueuedReview): boolean {
    if (!this.storage) {
      this.persistenceAvailable = false;
      return false;
    }
    try {
      this.storage.setItem(
        `${STORAGE_KEY_PREFIX}${item.clientReviewId}`,
        JSON.stringify(item)
      );
      this.persistenceAvailable = true;
      return true;
    } catch {
      this.persistenceAvailable = false;
      return false;
    }
  }

  private removeItem(clientReviewId: string): boolean {
    if (!this.storage) {
      this.persistenceAvailable = false;
      return false;
    }
    try {
      this.storage.removeItem(`${STORAGE_KEY_PREFIX}${clientReviewId}`);
      this.persistenceAvailable = true;
      return true;
    } catch {
      this.persistenceAvailable = false;
      return false;
    }
  }

  private handleOnline = (): void => {
    const now = Date.now();
    for (const item of this.queue) {
      if (item.retryable) item.nextAttemptAt = now;
      if (item.retryable) this.writeItem(item);
    }
    this.notify();
    this.drain();
  };

  private handleStorage = (event: StorageEvent): void => {
    if (event.key === null) {
      this.readStorage();
      this.notify();
      this.drain();
      return;
    }
    if (event.key === LEGACY_STORAGE_KEY) {
      if (event.newValue) this.readStorage();
      this.notify();
      this.drain();
      return;
    }
    if (!event.key.startsWith(STORAGE_KEY_PREFIX)) return;

    const clientReviewId = event.key.slice(STORAGE_KEY_PREFIX.length);
    const index = this.queue.findIndex(
      (item) => item.clientReviewId === clientReviewId
    );
    if (!event.newValue) {
      if (index >= 0) this.queue.splice(index, 1);
    } else {
      try {
        const item = normalizeQueuedReview(JSON.parse(event.newValue));
        if (!item) return;
        if (index >= 0) this.queue[index] = item;
        else this.queue.push(item);
        this.queue.sort(compareQueuedReviews);
      } catch {
        return;
      }
    }
    this.notify();
    this.drain();
  };

  private notify(): void {
    const state = this.getState();
    for (const listener of this.listeners) listener(state);
  }

  private scheduleNext(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    // Completion calls drain again. A timer for another ready item while the
    // request slot is full would otherwise spin every millisecond.
    if (!isOnline() || this.activeCards.size >= MAX_CONCURRENT_CARDS) return;

    const firstForCard = new Set<string>();
    let nextAt = Number.POSITIVE_INFINITY;
    for (const item of this.queue) {
      const key = this.cardKey(item);
      if (firstForCard.has(key)) continue;
      firstForCard.add(key);
      if (this.activeCards.has(key)) continue;
      if (!item.retryable || item.nextAttemptAt === null) continue;
      nextAt = Math.min(nextAt, item.nextAttemptAt);
    }
    if (!Number.isFinite(nextAt)) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.drain();
    }, Math.max(nextAt - Date.now(), 0));
  }

  private drain(): void {
    if (!isOnline()) return;
    const now = Date.now();
    const firstForCard = new Set<string>();

    for (const item of this.queue) {
      if (this.activeCards.size >= MAX_CONCURRENT_CARDS) break;
      const key = this.cardKey(item);
      if (firstForCard.has(key)) continue;
      firstForCard.add(key);
      if (
        this.activeCards.has(key) ||
        !item.retryable ||
        item.nextAttemptAt === null ||
        item.nextAttemptAt > now
      ) {
        continue;
      }
      this.activeCards.add(key);
      void this.send(item, key);
    }
    this.scheduleNext();
  }

  private async post(review: QueuedReview): Promise<PostResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: review.mode ?? "review",
          cardId: review.cardId,
          deckId: review.deckId,
          rating: review.rating,
          clientReviewId: review.clientReviewId,
          reviewedAt: review.reviewedAt,
        }),
        keepalive: true,
        signal: controller.signal,
      });
      if (res.ok) {
        // A login redirect or proxy HTML page is not a persisted review.
        const receipt = await res.json().catch(() => null);
        return receipt?.ok === true ? { ok: true } : { ok: false, retryable: true };
      }
      return {
        ok: false,
        // Authentication can recover after a login, and transient server errors
        // can recover later. Invalid, conflicting, or missing records cannot.
        retryable:
          res.status === 401 ||
          res.status === 408 ||
          res.status === 425 ||
          res.status === 429 ||
          res.status >= 500,
      };
    } catch {
      return { ok: false, retryable: true };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async send(review: QueuedReview, key: string): Promise<void> {
    const result = await this.post(review);
    const index = this.queue.findIndex(
      (item) => item.clientReviewId === review.clientReviewId
    );
    if (index >= 0) {
      if (result.ok) {
        this.queue.splice(index, 1);
        this.removeItem(review.clientReviewId);
      } else {
        const current = this.queue[index];
        current.attempts += 1;
        current.failed = true;
        current.retryable = result.retryable;
        current.nextAttemptAt = result.retryable
          ? Date.now() +
            Math.min(1_000 * 2 ** Math.min(current.attempts - 1, 8), MAX_RETRY_DELAY_MS)
          : null;
        if (!this.writeItem(current)) current.failed = true;
      }
    }
    this.activeCards.delete(key);
    this.notify();
    this.drain();
  }
}

let sharedQueue: ReviewQueue | null = null;

function getSharedQueue(): ReviewQueue {
  sharedQueue ??= new ReviewQueue();
  return sharedQueue;
}

export function createReviewSync(onFailure: (failedCount: number) => void) {
  // Keep construction pure: client components often create this handle during
  // render, including discarded React Strict Mode renders. The shared queue and
  // legacy failure subscription are both acquired lazily.
  const queue = () => getSharedQueue();
  let previousFailures: number | undefined;
  let unsubscribeFailure: (() => void) | null = null;

  const ensureFailureSubscription = () => {
    if (unsubscribeFailure) return;
    unsubscribeFailure = queue().subscribe((state) => {
      if (state.failedCount !== previousFailures) {
        previousFailures = state.failedCount;
        onFailure(state.failedCount);
      }
    });
  };

  return {
    /** Adds and durably persists a review before starting network I/O. */
    push(review: PendingReview): string {
      ensureFailureSubscription();
      return queue().push(review);
    },
    /** Current pending/failure detail for richer status UIs. */
    getState(): ReviewSyncState {
      return queue().getState();
    },
    subscribe(listener: StateListener): () => void {
      return queue().subscribe(listener);
    },
    retryFailed(): void {
      queue().retryFailed();
    },
    discardBlocked(): void {
      queue().discardBlocked();
    },
    dispose(): void {
      unsubscribeFailure?.();
      unsubscribeFailure = null;
      previousFailures = undefined;
    },
  };
}
