import { notFound } from "next/navigation";
import WriteSession from "@/components/WriteSession";
import { getStudyDeck } from "@/lib/study-sets";
import { isChineseLang } from "@/lib/write";

export default async function WritePage({
  params,
}: {
  params: Promise<{ deckId: string }>;
}) {
  const { deckId } = await params;
  const deck = await getStudyDeck(deckId);
  if (!deck) notFound();
  const chineseLang = [deck.frontLanguage, deck.backLanguage].find(isChineseLang) ?? "zh-CN";
  return <WriteSession deckId={deckId} chineseLang={chineseLang} backHref={`/decks/${deckId}`} />;
}
