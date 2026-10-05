import { uniqueWords } from "./words";
import { State } from "ts-fsrs";
import type { Card, DeckCounts } from "./types";

/** A corrupt due date surfaces as due so the card can be repaired by reviewing it. */
export function isDue(card: Card, now: Date): boolean {
  const due = Date.parse(card.fsrs.due);
  return !Number.isFinite(due) || due <= now.getTime();
}

export function isNew(card: Card): boolean {
  return card.fsrs.state === State.New;
}

/** Mid-step cards (for example, back from a 1h writing step) finish before anything else. */
export function isLearning(card: Card): boolean {
  return card.fsrs.state === State.Learning || card.fsrs.state === State.Relearning;
}

export function dueCards(cards: Card[], now: Date): Card[] {
  return uniqueWords(cards).filter((c) => isDue(c, now));
}

/** `due` counts started words awaiting review; unseen words are counted only in `newCards`. */
function countWords(words: Card[], now: Date, counts: DeckCounts): void {
  for (const card of words) {
    if (isNew(card)) counts.newCards += 1;
    else if (isDue(card, now)) counts.due += 1;
  }
}

export function countsByDeck(cards: Card[], now: Date): Map<string, DeckCounts> {
  const map = new Map<string, DeckCounts>();
  for (const card of cards) {
    const counts = map.get(card.deckId) ?? { total: 0, due: 0, newCards: 0 };
    counts.total += 1;
    map.set(card.deckId, counts);
  }
  for (const card of uniqueWords(cards)) countWords([card], now, map.get(card.deckId)!);
  return map;
}

export function totalCounts(cards: Card[], now: Date): DeckCounts {
  const counts = { total: cards.length, due: 0, newCards: 0 };
  countWords(uniqueWords(cards), now, counts);
  return counts;
}

/** Fisher-Yates shuffle; injectable random for deterministic tests. */
export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/** Cap on cards per review session; a short break is enforced between batches. */
export const SESSION_LIMIT = 25;
/** New words reserved in each batch even when reviews are backed up. */
const NEW_SLOTS_PER_BATCH = 11;

export type QueueOptions = {
  random?: () => number;
  limit?: number;
  /** Unseen words that may still be introduced (for example, today's remaining allowance). */
  newLimit?: number;
};

function priority(card: Card, now: Date): number {
  const due = Date.parse(card.fsrs.due);
  const overdueDays = Number.isFinite(due) ? (now.getTime() - due) / 86_400_000 : 0;
  return overdueDays +
    Math.min(card.practice?.failures ?? card.fsrs.lapses, 5) -
    Math.min(card.practice?.correctStreak ?? 0, 5) / 2;
}

/**
 * Due words split into reviews (learning steps first, then most overdue/difficult) and unseen words
 * (oldest first), with unseen words limited to the remaining new allowance.
 */
export function eligibleCards(cards: Card[], now: Date, newLimit = Infinity) {
  const due = dueCards(cards, now);
  const reviews = due.filter((card) => !isNew(card))
    .sort((a, b) => Number(isLearning(b)) - Number(isLearning(a)) || priority(b, now) - priority(a, now));
  const unseen = due.filter(isNew)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    .slice(0, Math.max(0, newLimit));
  return { reviews, unseen };
}

/**
 * Prioritize overdue/difficult words, reserve room for new vocabulary, and
 * shuffle a bounded batch. Future cards are never pulled in early.
 */
export function buildQueue(cards: Card[], now: Date, options: QueueOptions = {}): Card[] {
  const { random = Math.random, limit = SESSION_LIMIT, newLimit } = options;
  const { reviews, unseen } = eligibleCards(cards, now, newLimit);
  const newSlots = Math.min(NEW_SLOTS_PER_BATCH, unseen.length, limit);
  const selectedReviews = reviews.slice(0, limit - newSlots);
  const batch = [...selectedReviews, ...unseen.slice(0, limit - selectedReviews.length)];
  return shuffle(batch, random);
}
