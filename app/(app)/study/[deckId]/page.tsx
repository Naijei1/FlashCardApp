import { notFound } from "next/navigation";
import StudySession from "@/components/StudySession";
import { listDecks } from "@/lib/db";
import { isVirtualDeck, loadStudySet, studyFlipCards } from "@/lib/study-sets";

export default async function StudyPage({
  params,
}: {
  params: Promise<{ deckId: string }>;
}) {
  const { deckId } = await params;
  const preloadedDecks = isVirtualDeck(deckId) ? await listDecks() : undefined;
  const [set, decks] = await Promise.all([
    loadStudySet(deckId, preloadedDecks),
    preloadedDecks ? Promise.resolve(preloadedDecks) : listDecks(),
  ]);
  if (!set) notFound();
  const deckLangs = Object.fromEntries(
    decks.map((d) => [d.id, { front: d.frontLanguage, back: d.backLanguage }])
  );
  return <StudySession cards={studyFlipCards(set.cards)} deckLangs={deckLangs} backHref={`/decks/${deckId}`} />;
}
