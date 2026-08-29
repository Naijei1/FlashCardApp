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

const scheduler = fsrs(generatorParameters({ enable_fuzz: true }));

export { Rating, State };
export type { Grade };

export function toStored(card: FsrsCard): StoredFsrs {
  return {
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
