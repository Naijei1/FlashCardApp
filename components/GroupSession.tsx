"use client";

import { useMemo } from "react";
import type { GroupPlan } from "@/lib/practice-groups";
import type { ReviewMode } from "@/lib/types";
import ReviewSession from "./ReviewSession";
import type { StudySource } from "./useStudyQueue";
import WriteSession from "./WriteSession";

export function groupQueueUrl(groupId: string, mode: ReviewMode, plan: GroupPlan, includeNew = false): string {
  const params = new URLSearchParams({ mode, plan });
  if (includeNew) params.set("new", "1");
  return `/api/practice-groups/${encodeURIComponent(groupId)}/queue?${params}`;
}

/**
 * Study a practice group with the normal session screens. Ratings use the
 * usual four buttons and save through /api/review and the offline queue, to
 * every merged copy of the word.
 */
export default function GroupSession({
  groupId,
  mode,
  plan,
  deckLangs,
  chineseLang,
  backHref,
}: {
  groupId: string;
  mode: ReviewMode;
  plan: GroupPlan;
  deckLangs: Record<string, { front?: string; back?: string }>;
  chineseLang: string;
  backHref: string;
}) {
  const source = useMemo<StudySource>(() => ({
    scope: `group:${groupId}:${plan}`,
    url: (includeNew) => groupQueueUrl(groupId, mode, plan, includeNew),
  }), [groupId, mode, plan]);
  const emptyMessage = plan === "all"
    ? "This group has no cards you can practice in this mode."
    : "Nothing in this group is due today. Come back tomorrow, or try extra practice.";
  // deckId is only a label for virtual decks here; the queue comes from `source`.
  const deckId = `group:${groupId}`;
  if (mode === "review") {
    return <ReviewSession deckId={deckId} deckLangs={deckLangs} backHref={backHref} source={source} emptyMessage={emptyMessage} />;
  }
  return <WriteSession mode={mode} deckId={deckId} chineseLang={chineseLang} backHref={backHref} source={source} emptyMessage={emptyMessage} />;
}
