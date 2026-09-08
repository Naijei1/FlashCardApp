import { buildQueue, dueCards } from "./due";
import { previewIntervals, type IntervalPreview } from "./fsrs";
import type { Card } from "./types";

export type ReviewQueueData = {
  queue: Array<{ card: Card; intervals: IntervalPreview }>;
  totalDue: number;
};

/** Build the same bounded review batch for server-rendered pages and the API. */
export function buildReviewQueueData(
  cards: Card[],
  now: Date = new Date()
): ReviewQueueData {
  return {
    queue: buildQueue(cards, now).map((card) => ({
      card,
      intervals: previewIntervals(card.fsrs, now),
    })),
    totalDue: dueCards(cards, now).length,
  };
}
