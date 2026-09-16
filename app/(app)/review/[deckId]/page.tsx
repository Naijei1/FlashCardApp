import { notFound } from "next/navigation";
import ReviewSession from "@/components/ReviewSession";
import { listDecks } from "@/lib/db";

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ deckId: string }>;
}) {
  const { deckId } = await params;
  const decks = await listDecks();
  const deckLangs = Object.fromEntries(
    decks.map((d) => [d.id, { front: d.frontLanguage, back: d.backLanguage }])
  );

  if (deckId !== "all" && !decks.some((deck) => deck.id === deckId)) notFound();
  const backHref = deckId === "all" ? "/" : `/decks/${deckId}`;
  return (
    <ReviewSession
      deckId={deckId}
      deckLangs={deckLangs}
      backHref={backHref}
    />
  );
}
