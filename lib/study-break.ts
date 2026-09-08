/** Forced pause between review batches. */
export const BREAK_MS = 5 * 60_000;

const LEGACY_KEY = "study-break-until";
const KEY_PREFIX = "study-break-until-v2";

export type StudyBreakScope = {
  deckId: string;
  mode: "review" | "write" | "pinyin";
};

function keyFor({ deckId, mode }: StudyBreakScope): string {
  return `${KEY_PREFIX}:${mode}:${encodeURIComponent(deckId)}`;
}

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readUntil(storage: Storage, key: string): number {
  try {
    const raw = storage.getItem(key);
    const until = raw ? Number(raw) : 0;
    return Number.isFinite(until) && until > 0 ? until : 0;
  } catch {
    return 0;
  }
}

function remove(storage: Storage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // Storage can be disabled independently for reads and writes.
  }
}

export function getBreakUntil(scope: StudyBreakScope, now: number = Date.now()): number {
  const storage = getStorage();
  if (!storage) return 0;

  const key = keyFor(scope);
  const scopedUntil = readUntil(storage, key);
  if (scopedUntil > now) {
    // Remove the old global value even when a scoped value already exists.
    remove(storage, LEGACY_KEY);
    return scopedUntil;
  }
  remove(storage, key);

  // A legacy global break can only be assigned once. Migrate it to whichever
  // deck/mode the user resumes first, then remove the ambiguous global value.
  const legacyUntil = readUntil(storage, LEGACY_KEY);
  remove(storage, LEGACY_KEY);
  if (legacyUntil <= now) return 0;
  try {
    storage.setItem(key, String(legacyUntil));
  } catch {
    // The in-memory value is still useful for this visit.
  }
  return legacyUntil;
}

export function startBreak(scope: StudyBreakScope, now: number = Date.now()): number {
  const until = now + BREAK_MS;
  const storage = getStorage();
  if (!storage) return until;
  try {
    storage.setItem(keyFor(scope), String(until));
  } catch {
    // Private-mode storage failures just mean the break isn't persisted.
  }
  remove(storage, LEGACY_KEY);
  return until;
}

export function clearBreak(scope: StudyBreakScope): void {
  const storage = getStorage();
  if (!storage) return;
  remove(storage, keyFor(scope));
  remove(storage, LEGACY_KEY);
}

/** "4:59" style countdown; clamps at 0:00. */
export function formatCountdown(msLeft: number): string {
  const total = Math.max(0, Math.ceil(msLeft / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
