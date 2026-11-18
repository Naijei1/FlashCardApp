import { notFound } from "next/navigation";
import GroupSession from "@/components/GroupSession";
import { listDecks } from "@/lib/db";
import { getPracticeGroup } from "@/lib/practice-group-store";
import { requireLearnerPage } from "@/lib/guards";
import type { GroupPlan } from "@/lib/practice-groups";
import type { ReviewMode } from "@/lib/types";
import { isChineseLang } from "@/lib/write";

const MODES: ReviewMode[] = ["review", "write", "pinyin"];
const PLANS: GroupPlan[] = ["today", "all"];

export default async function GroupStudyPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string }>;
  searchParams?: Promise<{ mode?: string; plan?: string }>;
}) {
  await requireLearnerPage();
  const { groupId } = await params;
  const query = (await searchParams) ?? {};
  const mode = (MODES as string[]).includes(query.mode ?? "") ? (query.mode as ReviewMode) : "review";
  const plan = (PLANS as string[]).includes(query.plan ?? "") ? (query.plan as GroupPlan) : "today";
  const [group, decks] = await Promise.all([getPracticeGroup(groupId), listDecks()]);
  if (!group) notFound();
  const selected = decks.filter((deck) => group.deckIds.includes(deck.id));
  const deckLangs = Object.fromEntries(selected.map((d) => [d.id, { front: d.frontLanguage, back: d.backLanguage }]));
  const chineseLang = selected.flatMap((d) => [d.frontLanguage, d.backLanguage]).find(isChineseLang) ?? "zh-CN";
  return (
    <GroupSession key={`${mode}:${plan}`} groupId={group.id} mode={mode} plan={plan} deckLangs={deckLangs}
      chineseLang={chineseLang} backHref={`/groups/${encodeURIComponent(group.id)}`} />
  );
}
