import { notFound } from "next/navigation";
import ReviewSession from "@/components/ReviewSession";
import { listDecks } from "@/lib/db";
import { isVirtualDeck } from "@/lib/study-sets";

export default async function ReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ deckId: string }>;
  searchParams?: Promise<{ new?: string }>;
}) {
  const { deckId } = await params;
  const newOnly = (await searchParams)?.new === "1";
  const decks = await listDecks();
  if (!isVirtualDeck(deckId) && !decks.some((deck) => deck.id === deckId)) notFound();
  const deckLangs = Object.fromEntries(
    decks.map((d) => [d.id, { front: d.frontLanguage, back: d.backLanguage }])
  );
  return (
    <ReviewSession
      deckId={deckId}
      newOnly={newOnly}
      deckLangs={deckLangs}
      backHref={`/decks/${deckId}`}
    />
  );
}
