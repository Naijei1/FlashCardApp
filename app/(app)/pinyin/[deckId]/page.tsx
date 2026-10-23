import { notFound } from "next/navigation";
import WriteSession from "@/components/WriteSession";
import { redirectAdminFromStudy } from "@/lib/guards";
import { getStudyDeck } from "@/lib/study-sets";

export default async function PinyinPage({
  params,
}: {
  params: Promise<{ deckId: string }>;
}) {
  await redirectAdminFromStudy();
  const { deckId } = await params;
  if (!(await getStudyDeck(deckId))) notFound();
  return <WriteSession mode="pinyin" deckId={deckId} chineseLang="zh-CN" backHref={`/decks/${deckId}`} />;
}
