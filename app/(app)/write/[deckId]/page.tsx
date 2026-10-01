import { notFound } from "next/navigation";
import WriteSession from "@/components/WriteSession";
import { studyDeck as getDeck } from "@/lib/hard-words";
import { chineseSideForDeck, isChineseLang } from "@/lib/write";

export default async function WritePage({
  params,
}: {
  params: Promise<{ deckId: string }>;
}) {
  const { deckId } = await params;
  const deck = await getDeck(deckId);
  if (!deck) notFound();
  const backHref = `/decks/${deckId}`;

  const deckSide = chineseSideForDeck(deck);

  const chineseLang = isChineseLang(deck.frontLanguage)
    ? deck.frontLanguage!
    : isChineseLang(deck.backLanguage)
      ? deck.backLanguage!
      : "zh-CN";

  return (
    <WriteSession
      deckId={deckId}
      deckSide={deckSide}
      chineseLang={chineseLang}
      backHref={backHref}
    />
  );
}
