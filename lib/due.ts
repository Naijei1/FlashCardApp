import { State } from "ts-fsrs";
import type { Card, DeckCounts } from "./types";

export function isDue(card: Card, now: Date): boolean {
  return new Date(card.fsrs.due).getTime() <= now.getTime();
}

export function isNew(card: Card): boolean {
  return card.fsrs.state === State.New;
}

export function dueCards(cards: Card[], now: Date): Card[] {
  return cards.filter((c) => isDue(c, now));
}

export function countsByDeck(cards: Card[], now: Date): Map<string, DeckCounts> {
  const map = new Map<string, DeckCounts>();
  for (const card of cards) {
    let counts = map.get(card.deckId);
    if (!counts) {
      counts = { total: 0, due: 0, newCards: 0 };
      map.set(card.deckId, counts);
    }
    counts.total += 1;
    if (isDue(card, now)) counts.due += 1;
    if (isNew(card)) counts.newCards += 1;
  }
  return map;
}

export function totalCounts(cards: Card[], now: Date): DeckCounts {
  const counts: DeckCounts = { total: 0, due: 0, newCards: 0 };
  for (const card of cards) {
    counts.total += 1;
    if (isDue(card, now)) counts.due += 1;
    if (isNew(card)) counts.newCards += 1;
  }
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

/**
 * Cards for one review session: the most overdue cards first (FSRS priority),
 * capped at `limit`, then shuffled so the batch order isn't predictable.
 */
export function buildQueue(
  cards: Card[],
  now: Date,
  random: () => number = Math.random,
  limit: number = SESSION_LIMIT
): Card[] {
  const batch = dueCards(cards, now)
    .sort((a, b) => new Date(a.fsrs.due).getTime() - new Date(b.fsrs.due).getTime())
    .slice(0, limit);
  return shuffle(batch, random);
}
