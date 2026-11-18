import { buildQueue, eligibleCards, type QueueOptions } from "./due";
import type { PinyinReading } from "./pinyin";
import type { Card } from "./types";
import type { ChineseSide } from "./write";

export type StudyQueueItem = {
  card: Card;
  /** Chinese reading for cards with hanzi; review mode shows it instead of the raw sides. */
  pinyin?: PinyinReading;
  /** Side holding the Chinese answer, resolved with the card's own deck settings. */
  chineseSide?: ChineseSide;
  /**
   * Group sessions: every merged duplicate of this word (same hanzi + reading
   * across lessons or a reversed pair). A rating is saved to each copy.
   */
  copies?: Array<{ deckId: string; id: string }>;
  /** Group sessions: show from this time even if FSRS's own due date is later. */
  readyAt?: string;
};

export type ReviewQueueData = {
  queue: Array<{ card: Card }>;
  /** Every word eligible right now, including those beyond this batch. */
  totalDue: number;
  /** Unstarted words left after the new-word allowance, not the session batch cap. */
  remainingNew: number;
};

/** Build the same bounded review batch for server-rendered pages and the API. */
export function buildReviewQueueData(
  cards: Card[],
  now: Date = new Date(),
  options: QueueOptions = {}
): ReviewQueueData {
  const { reviews, unseen, remainingNew } = eligibleCards(cards, now, options.newLimit);
  return {
    queue: buildQueue(cards, now, options).map((card) => ({ card })),
    totalDue: reviews.length + unseen.length,
    remainingNew,
  };
}
