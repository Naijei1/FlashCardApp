/** Maximum delay for a card to remain in the current study session. */
export const SESSION_HORIZON_MS = 15 * 60_000;
export const RATE_LOCKOUT_MS = 250;

type Schedulable = { card: { fsrs: { due: string } } };

/** Identity used to avoid showing the same word twice in a row. */
export function studyItemKey(item: { card: { deckId: string; id: string } }): string {
  return `${item.card.deckId}\u0000${item.card.id}`;
}

/** Invalid stored dates should surface for repair instead of trapping the UI forever. */
export function queuedDueAt(item: Schedulable): number {
  const due = new Date(item.card.fsrs.due).getTime();
  return Number.isFinite(due) ? due : 0;
}

/** Indexes of cards whose wait is over (or that were never parked). */
export function readyIndexes<T extends Schedulable>(queue: T[], now: number): number[] {
  const indexes: number[] = [];
  for (let index = 0; index < queue.length; index++) {
    if (queuedDueAt(queue[index]) <= now) indexes.push(index);
  }
  return indexes;
}

/** Preserve queue order while skipping learning cards whose step is not due yet. */
export function firstReadyIndex<T extends Schedulable>(queue: T[], now: number): number {
  return readyIndexes(queue, now)[0] ?? -1;
}

export type PickIndexOptions<T> = {
  random?: () => number;
  /** Keep this card if it is still in the eligible set. */
  currentKey?: string | null;
  /** Skip this card when another eligible card exists. */
  avoidKey?: string | null;
  keyOf?: (item: T) => string;
};

function pickFrom(pool: number[], random: () => number): number {
  if (pool.length === 0) return -1;
  const roll = random();
  const index = Number.isFinite(roll) ? Math.floor(roll * pool.length) : 0;
  return pool[Math.min(pool.length - 1, Math.max(0, index))]!;
}

/**
 * Choose one eligible item at random. Waiting cards stay out of the pool.
 * When `currentKey` is still eligible it is kept so a visible card does not jump.
 * When another eligible card exists, `avoidKey` prevents an immediate repeat.
 */
export function pickIndex<T>(
  queue: T[],
  eligible: number[],
  options: PickIndexOptions<T> = {}
): number {
  if (eligible.length === 0) return -1;
  const keyOf = options.keyOf ?? ((item: T) => studyItemKey(item as { card: { deckId: string; id: string } }));
  if (options.currentKey) {
    const keep = eligible.find((index) => keyOf(queue[index]) === options.currentKey);
    if (keep !== undefined) return keep;
  }
  let pool = eligible;
  if (options.avoidKey && eligible.length > 1) {
    const filtered = eligible.filter((index) => keyOf(queue[index]) !== options.avoidKey);
    if (filtered.length > 0) pool = filtered;
  }
  return pickFrom(pool, options.random ?? Math.random);
}

/** Random eligible card that is due now, including requeued learning steps. */
export function pickReadyIndex<T extends Schedulable>(
  queue: T[],
  now: number,
  options: PickIndexOptions<T> = {}
): number {
  return pickIndex(queue, readyIndexes(queue, now), options);
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
