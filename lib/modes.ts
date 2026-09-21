import type { Card, ReviewMode } from "./types";
import { emptyCardState, type Grade } from "./fsrs";
import { rateCard } from "./practice";

/** Old unlabelled reviews belong to recognition; other skills start independently. */
export function cardForMode(card: Card, mode: ReviewMode): Card {
  if (mode === "review") return card;
  const state = card.modes?.[mode];
  return { ...card, fsrs: state?.fsrs ?? emptyCardState(new Date(card.createdAt)), practice: state?.practice };
}

export function rateMode(card: Card, mode: ReviewMode, rating: Grade, now: Date) {
  const result = rateCard(cardForMode(card, mode), rating, now);
  if (mode === "review") return result;
  // Learning another skill for a legacy known word is not new vocabulary.
  if (card.fsrs.reps > 0 && !card.practice?.firstStudiedAt) {
    delete result.card.practice.firstStudiedAt;
  }
  return { ...result, card: { ...card, updatedAt: now.toISOString(), modes: {
    ...card.modes, [mode]: { fsrs: result.card.fsrs, practice: result.card.practice },
  } } };
}
