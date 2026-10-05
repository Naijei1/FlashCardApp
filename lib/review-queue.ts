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
};

export type ReviewQueueData = {
  queue: Array<{ card: Card }>;
  /** Every word eligible right now, including those beyond this batch. */
  totalDue: number;
};

/** Build the same bounded review batch for server-rendered pages and the API. */
export function buildReviewQueueData(
  cards: Card[],
  now: Date = new Date(),
  options: Omit<QueueOptions, "random"> = {}
): ReviewQueueData {
  const { reviews, unseen } = eligibleCards(cards, now, options.newLimit);
  return {
    queue: buildQueue(cards, now, options).map((card) => ({ card })),
    totalDue: reviews.length + unseen.length,
  };
}
