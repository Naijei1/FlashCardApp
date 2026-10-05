import { notFound } from "next/navigation";
import StudySession from "@/components/StudySession";
import { listDecks } from "@/lib/db";
import { loadStudySet } from "@/lib/study-sets";

export default async function StudyPage({
  params,
}: {
  params: Promise<{ deckId: string }>;
}) {
  const { deckId } = await params;
  const [set, decks] = await Promise.all([loadStudySet(deckId), listDecks()]);
  if (!set) notFound();
  const deckLangs = Object.fromEntries(
    decks.map((d) => [d.id, { front: d.frontLanguage, back: d.backLanguage }])
  );
  return <StudySession cards={set.cards} deckLangs={deckLangs} backHref={`/decks/${deckId}`} />;
}
