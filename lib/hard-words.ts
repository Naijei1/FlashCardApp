import { getDeck, listAllCards, listCards } from "./db";
import { wordKey } from "./words";
import type { Card, Deck } from "./types";
export const HARD_DECK = "hard-words";
export function hardWords(cards: Card[]): Card[] {
  const marked = new Set(cards.filter((card) => card.hard).map(wordKey));
  return cards.filter((card) => marked.has(wordKey(card))).map((card) => ({ ...card, hard: true }));
}
export async function studyDeck(id: string): Promise<Deck | null> {
  return id === HARD_DECK ? { id, name: "Hard Words", createdAt: "", updatedAt: "" } : getDeck(id);
}
export async function studyCards(id: string) {
  return id === HARD_DECK ? hardWords(await listAllCards(undefined, { consistent: true }))
    : listCards(id, { consistent: true });
}
