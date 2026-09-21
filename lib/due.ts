import { uniqueWords } from "./words";
import { State } from "ts-fsrs";
import type { Card, DeckCounts } from "./types";

export function isDue(card: Card, now: Date): boolean {
  return new Date(card.fsrs.due).getTime() <= now.getTime();
}

export function isNew(card: Card): boolean {
  return card.fsrs.state === State.New;
}

export function dueCards(cards: Card[], now: Date): Card[] {
  return uniqueWords(cards).filter((c) => isDue(c, now));
}

export function countsByDeck(cards: Card[], now: Date): Map<string, DeckCounts> {
  const map = new Map<string, DeckCounts>();
  for (const card of cards) {
    const counts = map.get(card.deckId) ?? { total: 0, due: 0, newCards: 0 };
    counts.total += 1;
    map.set(card.deckId, counts);
  }
  for (const card of uniqueWords(cards)) {
    const counts = map.get(card.deckId)!;
    if (isDue(card, now)) counts.due += 1;
    if (isNew(card)) counts.newCards += 1;
  }
  return map;
}

export function totalCounts(cards: Card[], now: Date): DeckCounts {
  const words = uniqueWords(cards);
  return { total: cards.length, due: words.filter((card) => isDue(card, now)).length,
    newCards: words.filter(isNew).length };
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

/**
 * Prioritize overdue/difficult words, reserve room for new vocabulary, and
 * shuffle a bounded batch. Future cards are never pulled in early.
 */
export function buildQueue(
  cards: Card[],
  now: Date,
  random: () => number = Math.random,
  limit: number = SESSION_LIMIT
): Card[] {
  const ordered = dueCards(cards, now)
    .sort((a, b) => {
      // Reviewed words take priority over an old import of unseen vocabulary.
      if (isNew(a) !== isNew(b)) return isNew(a) ? 1 : -1;
      const priority = (card: Card) =>
        (now.getTime() - Date.parse(card.fsrs.due)) / 86_400_000 +
        Math.min(card.practice?.failures ?? card.fsrs.lapses, 5) -
        Math.min(card.practice?.correctStreak ?? 0, 5) / 2;
      return priority(b) - priority(a);
    });
  const unseen = ordered.filter(isNew);
  const reviews = ordered.filter((card) => !isNew(card));
  // Reserve room for about a day's new vocabulary even with a review backlog.
  const newSlots = Math.min(11, unseen.length, limit);
  const selectedReviews = reviews.slice(0, limit - newSlots);
  const batch = [...selectedReviews, ...unseen.slice(0, limit - selectedReviews.length)];
  return shuffle(batch, random);
}
