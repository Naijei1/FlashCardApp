import type { Card } from "./types";

/** Exact duplicate/reverse pairs share a word; distinct meanings remain separate. */
export function wordKey(card: Pick<Card, "deckId" | "front" | "back">): string {
  const sides = [card.front, card.back].map((side) => side.normalize("NFC").trim().replace(/\s+/g, " "));
  return JSON.stringify([card.deckId, ...sides.sort()]);
}

/** Keep the latest practiced copy, even when its unreviewed siblings are due. */
export function uniqueWords(cards: Card[]): Card[] {
  const words = new Map<string, Card>();
  const reviewedAt = (card: Card) => Date.parse(card.fsrs.last_review ?? "") || 0;
  for (const card of cards) {
    const key = wordKey(card);
    const previous = words.get(key);
    if (!previous || reviewedAt(card) > reviewedAt(previous) ||
      (reviewedAt(card) === reviewedAt(previous) && (card.fsrs.reps > previous.fsrs.reps ||
        (card.fsrs.reps === previous.fsrs.reps && card.id < previous.id)))) words.set(key, card);
  }
  return [...words.values()];
}
