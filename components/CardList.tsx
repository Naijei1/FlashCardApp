import type { Card, Deck } from "@/lib/types";
import CardRow from "./CardRow";

/** Card rows with optional source-deck labels for views that mix lessons. */
export default function CardList({
  cards,
  decks,
  showDeckNames = false,
}: {
  cards: Card[];
  decks: Deck[];
  showDeckNames?: boolean;
}) {
  const byId = new Map(decks.map((deck) => [deck.id, deck]));
  return (
    <ul className="grid gap-2 xl:grid-cols-2">
      {cards.map((card) => (
        <li key={`${card.deckId}:${card.id}`}>
          {showDeckNames && (
            <div className="mb-1 px-1 text-xs font-medium text-muted">
              {byId.get(card.deckId)?.name ?? "Unknown deck"}
            </div>
          )}
          <CardRow card={card} decks={decks} frontLang={byId.get(card.deckId)?.frontLanguage} />
        </li>
      ))}
    </ul>
  );
}
