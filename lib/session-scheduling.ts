/** Maximum delay for a card to remain in the current study session. */
export const SESSION_HORIZON_MS = 15 * 60_000;
export const RATE_LOCKOUT_MS = 250;

type Schedulable = { card: { fsrs: { due: string } } };

/** Invalid stored dates should surface for repair instead of trapping the UI forever. */
export function queuedDueAt(item: Schedulable): number {
  const due = new Date(item.card.fsrs.due).getTime();
  return Number.isFinite(due) ? due : 0;
}

/** Preserve queue order while skipping learning cards whose step is not due yet. */
export function firstReadyIndex<T extends Schedulable>(queue: T[], now: number): number {
  return queue.findIndex((item) => queuedDueAt(item) <= now);
}

/** Earliest time at which a currently parked card becomes available. */
export function nextQueuedDue<T extends Schedulable>(queue: T[], now: number): number | null {
  let earliest = Number.POSITIVE_INFINITY;
  for (const item of queue) {
    const due = queuedDueAt(item);
    if (due > now && due < earliest) earliest = due;
  }
  return Number.isFinite(earliest) ? earliest : null;
}

export function belongsInCurrentSession(due: string, ratedAt: number): boolean {
  const dueAt = new Date(due).getTime();
  return Number.isFinite(dueAt) && dueAt <= ratedAt + SESSION_HORIZON_MS;
}

/** The first accepted rating has no artificial delay; later taps are debounced. */
export function canAcceptRating(lastAcceptedAt: number | null, attemptAt: number): boolean {
  return lastAcceptedAt === null || attemptAt - lastAcceptedAt >= RATE_LOCKOUT_MS;
}
