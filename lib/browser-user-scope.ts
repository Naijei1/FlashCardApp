/**
 * Browser storage for reviews and study prefs is keyed by the app user id.
 * Legacy unscoped keys are quarantined when a user signs in so the next
 * account on this browser cannot sync them.
 */

const REVIEW_PREFIX = "flashcards.pending-review.v2:";
const REVIEW_QUARANTINE_PREFIX = "flashcards.pending-review.quarantine.v2:";
const BREAK_PREFIX = "study-break-until-v2:";
const REPEAT_KEY = "flashcards.repeat-mistakes.v1";
const LEGACY_BREAK_KEY = "study-break-until";

type ScopeListener = (userId: string | null, previous: string | null) => void;

let userId: string | null = null;
const listeners = new Set<ScopeListener>();

export function currentLocalUserId(): string | null {
  return userId;
}

export function subscribeLocalUser(listener: ScopeListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function keysOf(store: Storage): string[] {
  const keys: string[] = [];
  for (let index = 0; index < store.length; index++) {
    const key = store.key(index);
    if (key) keys.push(key);
  }
  return keys;
}

function removeKey(store: Storage, key: string): void {
  try {
    store.removeItem(key);
  } catch {
    // Storage can reject writes independently of reads.
  }
}

/** Move pre-user review keys aside and drop shared break/repeat prefs. */
export function quarantineSharedBrowserState(store: Storage = storage() ?? emptyStorage()): void {
  for (const key of keysOf(store)) {
    if (key.startsWith(REVIEW_PREFIX)) {
      const rest = key.slice(REVIEW_PREFIX.length);
      if (!rest.includes(":")) {
        try {
          const value = store.getItem(key);
          if (value !== null) store.setItem(`${REVIEW_QUARANTINE_PREFIX}${rest}`, value);
        } catch {
          // Leave the original key if the quarantine write fails.
          continue;
        }
        removeKey(store, key);
      }
    } else if (key === LEGACY_BREAK_KEY || key === REPEAT_KEY || /^study-break-until-v2:(review|write|pinyin):/.test(key)) {
      removeKey(store, key);
    }
  }
}

function emptyStorage(): Storage {
  return {
    length: 0,
    clear() {},
    getItem() {
      return null;
    },
    key() {
      return null;
    },
    removeItem() {},
    setItem() {},
  };
}

export function bindLocalUser(next: string | null): void {
  if (next === userId) return;
  const previous = userId;
  if (next) quarantineSharedBrowserState();
  userId = next;
  for (const listener of listeners) listener(next, previous);
}

export function reviewStoragePrefix(): string {
  return userId ? `${REVIEW_PREFIX}${userId}:` : REVIEW_PREFIX;
}

export function studyBreakStorageKey(mode: string, deckId: string): string {
  const rest = `${mode}:${encodeURIComponent(deckId)}`;
  return userId ? `${BREAK_PREFIX}${userId}:${rest}` : `${BREAK_PREFIX}${rest}`;
}

export function repeatMistakesStorageKey(): string {
  return userId ? `${REPEAT_KEY}:${userId}` : REPEAT_KEY;
}

/** Drop this account's offline queue and study prefs, then forget the scope. */
export function clearLocalUserData(): void {
  const id = userId;
  const store = storage();
  if (store && id) {
    for (const key of keysOf(store)) {
      if (
        key.startsWith(`${REVIEW_PREFIX}${id}:`) ||
        key.startsWith(`${BREAK_PREFIX}${id}:`) ||
        key === `${REPEAT_KEY}:${id}`
      ) {
        removeKey(store, key);
      }
    }
  }
  const previous = userId;
  userId = null;
  for (const listener of listeners) listener(null, previous);
}
