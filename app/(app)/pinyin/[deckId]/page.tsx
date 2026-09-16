import { notFound } from "next/navigation";
import WriteSession from "@/components/WriteSession";
import { getDeck } from "@/lib/db";
import { chineseSideForDeck } from "@/lib/write";

export default async function PinyinPage({
  params,
}: {
  params: Promise<{ deckId: string }>;
}) {
  const { deckId } = await params;
  const deck = await getDeck(deckId);
  if (!deck) notFound();
  const deckSide = chineseSideForDeck(deck);
  return (
    <WriteSession
      mode="pinyin"
      deckId={deckId}
      deckSide={deckSide}
      chineseLang="zh-CN"
      backHref={`/decks/${deckId}`}
    />
  );
}
