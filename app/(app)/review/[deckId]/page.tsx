import { notFound } from "next/navigation";
import ReviewSession from "@/components/ReviewSession";
import { listAllCards, listCards, listDecks } from "@/lib/db";
import { buildReviewQueueData } from "@/lib/review-queue";

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ deckId: string }>;
}) {
  const { deckId } = await params;
  const { decks, cards } =
    deckId === "all"
      ? await (async () => {
          const allDecks = await listDecks();
          return {
            decks: allDecks,
            cards: await listAllCards(allDecks, { consistent: true }),
          };
        })()
      : await (async () => {
          const [oneDecks, deckCards] = await Promise.all([
            listDecks(),
            listCards(deckId, { consistent: true }),
          ]);
          return { decks: oneDecks, cards: deckCards };
        })();
  const deckLangs = Object.fromEntries(
    decks.map((d) => [d.id, { front: d.frontLanguage, back: d.backLanguage }])
  );

  if (deckId !== "all" && !decks.some((deck) => deck.id === deckId)) notFound();
  const initialData = buildReviewQueueData(cards);
  const backHref = deckId === "all" ? "/" : `/decks/${deckId}`;
  return (
    <ReviewSession
      deckId={deckId}
      deckLangs={deckLangs}
      backHref={backHref}
      initialData={initialData}
    />
  );
}
