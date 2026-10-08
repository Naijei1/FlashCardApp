import MistakeClinicSession from "@/components/MistakeClinicSession";
import { listDecks } from "@/lib/db";

export default async function MistakeClinicPage() {
  const decks = await listDecks();
  const deckLangs = Object.fromEntries(
    decks.map((deck) => [deck.id, { front: deck.frontLanguage, back: deck.backLanguage }])
  );
  return <MistakeClinicSession deckLangs={deckLangs} />;
}
