import { studyCards } from "@/lib/hard-words";
import { notFound } from "next/navigation";
import StudySession from "@/components/StudySession";
import { listAllCards, listCards, listDecks } from "@/lib/db";

export default async function StudyPage({
  params,
}: {
  params: Promise<{ deckId: string }>;
}) {
  const { deckId } = await params;
  const { decks, cards } =
    deckId === "all"
      ? await (async () => {
          const allDecks = await listDecks();
          return { decks: allDecks, cards: await listAllCards(allDecks) };
        })()
      : await (async () => {
          const [oneDecks, deckCards] = await Promise.all([
            listDecks(),
            listCards(deckId),
          ]);
          return { decks: oneDecks, cards: deckCards };
        })();
  const deckLangs = Object.fromEntries(
    decks.map((d) => [d.id, { front: d.frontLanguage, back: d.backLanguage }])
  );

  if (deckId === "hard-words") return <StudySession cards={await studyCards(deckId)} deckLangs={deckLangs} backHref="/decks/hard-words" />;
  if (deckId === "all") {
    return <StudySession cards={cards} deckLangs={deckLangs} backHref="/" />;
  }
  const deck = decks.find((candidate) => candidate.id === deckId);
  if (!deck) notFound();
  return <StudySession cards={cards} deckLangs={deckLangs} backHref={`/decks/${deckId}`} />;
}
