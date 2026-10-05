import { notFound } from "next/navigation";
import WriteSession from "@/components/WriteSession";
import { getStudyDeck } from "@/lib/study-sets";

export default async function PinyinPage({
  params,
}: {
  params: Promise<{ deckId: string }>;
}) {
  const { deckId } = await params;
  if (!(await getStudyDeck(deckId))) notFound();
  return <WriteSession mode="pinyin" deckId={deckId} chineseLang="zh-CN" backHref={`/decks/${deckId}`} />;
}
