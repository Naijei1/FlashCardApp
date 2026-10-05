import { getDeck, listAllCards, listCards, listDecks } from "./db";
import { wordKey } from "./words";
import { chineseSideForDeck, type ChineseSide } from "./write";
import type { Card, Deck } from "./types";

export const HARD_DECK = "hard-words";
export const ALL_DECK = "all";

const VIRTUAL_DECK_NAMES: Record<string, string> = {
  [ALL_DECK]: "All Cards",
  [HARD_DECK]: "Hard Words",
};

/** Virtual decks gather cards from every lesson; cards keep their real deckId. */
export function isVirtualDeck(id: string): boolean {
  return id in VIRTUAL_DECK_NAMES;
}

export function hardWords(cards: Card[]): Card[] {
  const marked = new Set(cards.filter((card) => card.hard).map(wordKey));
  return cards.filter((card) => marked.has(wordKey(card))).map((card) => ({ ...card, hard: true }));
}

function virtualDeck(id: string): Deck {
  return { id, name: VIRTUAL_DECK_NAMES[id], createdAt: "", updatedAt: "" };
}

/** Deck metadata only, for pages whose cards are loaded by the queue API. */
export async function getStudyDeck(id: string): Promise<Deck | null> {
  return isVirtualDeck(id) ? virtualDeck(id) : getDeck(id);
}

export type StudySet = {
  deck: Deck;
  cards: Card[];
  /** Deck-level Chinese side for a card, from the card's own lesson. */
  sideFor: (card: Card) => ChineseSide | null;
};

/** Loads a real deck, All Cards, or Hard Words with strongly consistent card reads. */
export async function loadStudySet(id: string): Promise<StudySet | null> {
  if (isVirtualDeck(id)) {
    const decks = await listDecks();
    const all = await listAllCards(decks, { consistent: true });
    const sides = new Map(decks.map((deck) => [deck.id, chineseSideForDeck(deck)]));
    return {
      deck: virtualDeck(id),
      cards: id === HARD_DECK ? hardWords(all) : all,
      sideFor: (card) => sides.get(card.deckId) ?? null,
    };
  }
  const [deck, cards] = await Promise.all([getDeck(id), listCards(id, { consistent: true })]);
  if (!deck) return null;
  const side = chineseSideForDeck(deck);
  return { deck, cards, sideFor: () => side };
}
