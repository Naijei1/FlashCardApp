import MistakeClinicSession from "@/components/MistakeClinicSession";
import { listDecks } from "@/lib/db";
import { redirectAdminFromStudy } from "@/lib/guards";

export default async function MistakeClinicPage() {
  await redirectAdminFromStudy();
  const decks = await listDecks();
  const deckLangs = Object.fromEntries(
    decks.map((deck) => [deck.id, { front: deck.frontLanguage, back: deck.backLanguage }])
  );
  return <MistakeClinicSession deckLangs={deckLangs} />;
}
