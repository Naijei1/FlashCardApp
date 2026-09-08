import { notFound } from "next/navigation";
import ChineseSideChooser from "@/components/ChineseSideChooser";
import WriteSession from "@/components/WriteSession";
import { getDeck, listCards } from "@/lib/db";
import { buildReviewQueueData } from "@/lib/review-queue";
import { chineseSideForCard, chineseSideForDeck, isChineseLang } from "@/lib/write";

export default async function WritePage({
  params,
}: {
  params: Promise<{ deckId: string }>;
}) {
  const { deckId } = await params;
  const [deck, cards] = await Promise.all([
    getDeck(deckId),
    listCards(deckId, { consistent: true }),
  ]);
  if (!deck) notFound();
  const backHref = `/decks/${deckId}`;

  // Each card's side is detected from its own text (decks often hold both
  // directions); the deck-level setting is only needed for ambiguous cards.
  const deckSide = chineseSideForDeck(deck);
  const hasAmbiguousCards = cards.some((c) => chineseSideForCard(c, null) === null);
  if (!deckSide && hasAmbiguousCards) {
    return <ChineseSideChooser deck={deck} backHref={backHref} />;
  }

  const chineseLang = isChineseLang(deck.frontLanguage)
    ? deck.frontLanguage!
    : isChineseLang(deck.backLanguage)
      ? deck.backLanguage!
      : "zh-CN";
  const writableCards = cards.filter(
    (card) => chineseSideForCard(card, deckSide) !== null
  );

  return (
    <WriteSession
      deckId={deckId}
      deckSide={deckSide}
      chineseLang={chineseLang}
      backHref={backHref}
      initialData={buildReviewQueueData(writableCards)}
    />
  );
}
