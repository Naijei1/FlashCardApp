import { notFound } from "next/navigation";
import StudySession from "@/components/StudySession";
import { getDeck, listCards, listDecks, scanAllCards } from "@/lib/db";

export default async function StudyPage({
  params,
}: {
  params: Promise<{ deckId: string }>;
}) {
  const { deckId } = await params;
  const decks = await listDecks();
  const deckLangs = Object.fromEntries(
    decks.map((d) => [d.id, { front: d.frontLanguage, back: d.backLanguage }])
  );

  if (deckId === "all") {
    const cards = await scanAllCards();
    return <StudySession cards={cards} deckLangs={deckLangs} backHref="/" />;
  }
  const deck = await getDeck(deckId);
  if (!deck) notFound();
  const cards = await listCards(deckId);
  return <StudySession cards={cards} deckLangs={deckLangs} backHref={`/decks/${deckId}`} />;
}
