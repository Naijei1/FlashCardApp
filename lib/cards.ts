import { randomUUID } from "node:crypto";
import type { Card } from "./types";
import { emptyCardState } from "./fsrs";

export type NewCardInput = {
  deckId: string;
  front: string;
  back: string;
  notes?: string;
  /** Also create an independent back→front card. */
  reverse?: boolean;
};

/** Builds 1 or 2 cards; a reverse card gets its own id and fresh FSRS state. */
export function buildCards(
  input: NewCardInput,
  now: Date,
  idGen: () => string = randomUUID
): Card[] {
  const base = {
    deckId: input.deckId,
    ...(input.notes ? { notes: input.notes } : {}),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  const cards: Card[] = [
    { ...base, id: idGen(), front: input.front, back: input.back, fsrs: emptyCardState(now) },
  ];
  if (input.reverse) {
    cards.push({
      ...base,
      id: idGen(),
      front: input.back,
      back: input.front,
      fsrs: emptyCardState(now),
    });
  }
  return cards;
}
