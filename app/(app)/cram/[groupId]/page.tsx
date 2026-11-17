import { notFound } from "next/navigation";
import CramSession from "@/components/CramSession";
import { loadCramSet } from "@/lib/cram-set";
import { requireLearnerPage } from "@/lib/guards";

export default async function CramPage({ params }: { params: Promise<{ groupId: string }> }) {
  await requireLearnerPage();
  const { groupId } = await params;
  const set = await loadCramSet(groupId);
  if (!set) notFound();
  return <CramSession cards={set.cards} title={set.group.name} backHref={`/groups/${encodeURIComponent(groupId)}`} />;
}
