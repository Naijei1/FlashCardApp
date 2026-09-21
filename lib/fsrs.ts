import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  State,
  type Card as FsrsCard,
  type Grade,
  type ReviewLog,
} from "ts-fsrs";
import type { StoredFsrs } from "./types";
import { formatInterval } from "./interval-label";

// A single-user app benefits more from truthful button labels than from
// randomized workload distribution. Fuzzing is timestamp-seeded, so a label
// previewed milliseconds before submission can otherwise differ by days from
// the interval that is actually stored.
const scheduler = fsrs(generatorParameters({ request_retention: 0.95, enable_fuzz: false, learning_steps: ["1m"], relearning_steps: ["1m"] }));

export { Rating, State };
export type { Grade };

export function toStored(card: FsrsCard): StoredFsrs {
  return {
    retentionTarget: 0.95,
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    ...(card.last_review ? { last_review: card.last_review.toISOString() } : {}),
  };
}

export function toFsrsCard(stored: StoredFsrs): FsrsCard {
  return {
    due: new Date(stored.due),
    stability: stored.stability,
    difficulty: stored.difficulty,
    elapsed_days: stored.elapsed_days,
    scheduled_days: stored.scheduled_days,
    learning_steps: stored.learning_steps,
    reps: stored.reps,
    lapses: stored.lapses,
    state: stored.state,
    last_review: stored.last_review ? new Date(stored.last_review) : undefined,
  };
}

export function emptyCardState(now: Date): StoredFsrs {
  return toStored(createEmptyCard(now));
}

export type IntervalPreview = {
  again: string;
  hard: string;
  good: string;
  easy: string;
};

/**
 * Labels for the next interval of each rating. Uses due - now rather than
 * scheduled_days because scheduled_days is 0 during (re)learning steps.
 */
export function previewIntervals(stored: StoredFsrs, now: Date): IntervalPreview {
  const preview = scheduler.repeat(toFsrsCard(stored), now);
  const label = (grade: Grade) =>
    formatInterval(preview[grade].card.due.getTime() - now.getTime());
  return {
    again: label(Rating.Again),
    hard: label(Rating.Hard),
    good: label(Rating.Good),
    easy: label(Rating.Easy),
  };
}

export function applyRating(
  stored: StoredFsrs,
  rating: Grade,
  now: Date
): { fsrs: StoredFsrs; log: ReviewLog } {
  const { card, log } = scheduler.next(toFsrsCard(stored), now, rating);
  return { fsrs: toStored(card), log };
}

/** Recompute legacy long-term due dates at 95%, without adding a review or erasing history. */
export function currentRetentionSchedule(stored: StoredFsrs): StoredFsrs {
  if (stored.retentionTarget === 0.95 || stored.state !== State.Review ||
      !stored.last_review || stored.stability <= 0) return stored;
  const last = Date.parse(stored.last_review);
  if (!Number.isFinite(last)) return stored;
  const days = scheduler.next_interval(stored.stability, stored.elapsed_days);
  const due = new Date(Math.min(Date.parse(stored.due), last + days * 86_400_000)).toISOString();
  return { ...stored, due, scheduled_days: Math.max(0, Math.round((Date.parse(due) - last) / 86_400_000)), retentionTarget: 0.95 };
}
