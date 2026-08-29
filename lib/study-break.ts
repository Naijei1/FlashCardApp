/** Forced pause between review batches. */
export const BREAK_MS = 5 * 60_000;

const KEY = "study-break-until";

export function getBreakUntil(): number {
  if (typeof window === "undefined") return 0;
  const raw = window.localStorage.getItem(KEY);
  const until = raw ? Number(raw) : 0;
  return Number.isFinite(until) ? until : 0;
}

export function startBreak(now: number = Date.now()): number {
  const until = now + BREAK_MS;
  try {
    window.localStorage.setItem(KEY, String(until));
  } catch {
    // Private-mode storage failures just mean the break isn't persisted.
  }
  return until;
}

export function clearBreak(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

/** "4:59" style countdown; clamps at 0:00. */
export function formatCountdown(msLeft: number): string {
  const total = Math.max(0, Math.ceil(msLeft / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
