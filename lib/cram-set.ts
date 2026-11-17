import { buildCramCards, type CramCard } from "./cram";
import { listAllCards, listDecks } from "./db";
import { getPracticeGroup } from "./practice-group-store";
import { resolveGroupDecks, type PracticeGroup } from "./practice-groups";
import type { Card, Deck } from "./types";

export type CramSet = {
  group: PracticeGroup;
  decks: Deck[];
  /** Saved lessons the learner can no longer see (hidden, unpublished, deleted). */
  missing: number;
  cards: CramCard[];
};

/**
 * Loads a saved group for a cram session. Lessons are re-resolved against the
 * learner's visible decks on every read, and cards come from the same gated
 * reads as normal study, so unreleased weeks and hidden cards never appear.
 * Read-only: nothing here touches progress or the review schedule.
 */
export async function loadCramSet(
  groupId: string,
  known?: { decks: Deck[]; cards?: Card[] }
): Promise<CramSet | null> {
  const [group, visible] = await Promise.all([
    getPracticeGroup(groupId),
    known ? Promise.resolve(known.decks) : listDecks(),
  ]);
  if (!group) return null;
  const { decks, missing } = resolveGroupDecks(group, visible);
  const selected = new Set(decks.map((deck) => deck.id));
  const cards = known?.cards
    ? known.cards.filter((card) => selected.has(card.deckId))
    : decks.length > 0 ? await listAllCards(decks) : [];
  return { group, decks, missing, cards: buildCramCards(cards, decks) };
}
