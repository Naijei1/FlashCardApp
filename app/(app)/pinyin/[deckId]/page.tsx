import { notFound } from "next/navigation";
import WriteSession from "@/components/WriteSession";
import { getDeck, listCards } from "@/lib/db";
import { buildPinyinQueueData } from "@/lib/pinyin-queue";
import { chineseSideForDeck } from "@/lib/write";

export default async function PinyinPage({
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
  const deckSide = chineseSideForDeck(deck);
  return (
    <WriteSession
      mode="pinyin"
      deckId={deckId}
      deckSide={deckSide}
      chineseLang="zh-CN"
      backHref={`/decks/${deckId}`}
      initialData={buildPinyinQueueData(cards, deckSide)}
    />
  );
}
