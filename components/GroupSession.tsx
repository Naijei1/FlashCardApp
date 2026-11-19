"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addLessonRating, ATTRIBUTION_NOTE, describeChange, loadPracticeSession, practiceSessionKey, previousPracticeSession, ratingCount, storePracticeSession, struggleRate, SKILL_NAMES, type PracticeSession } from "@/lib/lesson-stats";
import type { Grade } from "@/lib/fsrs";
import { plural } from "@/lib/plural";
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

function sessionStorageIfAvailable(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
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
  recentSessions = [],
  lessonNames = {},
  chineseLang,
  backHref,
}: {
  groupId: string;
  mode: ReviewMode;
  plan: GroupPlan;
  recentSessions?: readonly PracticeSession[];
  lessonNames?: Record<string, string>;
  deckLangs: Record<string, { front?: string; back?: string }>;
  chineseLang: string;
  backHref: string;
}) {
  const latest = useRef<PracticeSession | null>(null);
  const [snapshot, setSnapshot] = useState<PracticeSession | null>(null);
  const [saveState, setSaveState] = useState<"saving" | "saved" | "failed">("saved");
  const storageKey = practiceSessionKey(groupId, mode);
  useEffect(() => {
    const resumed = loadPracticeSession(sessionStorageIfAvailable(), storageKey, mode);
    if (resumed) {
      latest.current = resumed;
      setSnapshot(resumed);
    }
  }, [mode, storageKey]);
  const onFinish = useCallback(() => {
    storePracticeSession(sessionStorageIfAvailable(), storageKey, null);
  }, [storageKey]);
  const save = useCallback(async () => {
    const data = latest.current;
    if (!data) return;
    setSaveState("saving");
    try {
      const body = JSON.stringify(data);
      const res = await fetch(`/api/practice-groups/${encodeURIComponent(groupId)}/sessions`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: new TextEncoder().encode(body).length < 16_000,
      });
      if (!res.ok) throw new Error(String(res.status));
      if (latest.current === data) setSaveState("saved");
    } catch {
      if (latest.current === data) setSaveState("failed");
    }
  }, [groupId]);
  useEffect(() => {
    if (saveState !== "failed") return;
    window.addEventListener("online", save);
    return () => window.removeEventListener("online", save);
  }, [save, saveState]);
  const onRating = useCallback((copies: readonly { deckId: string }[], grade: Grade, reviewedAt: string) => {
    const current = latest.current ?? {
      id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      startedAt: reviewedAt, mode, lessons: {},
    };
    latest.current = { ...current, lessons: addLessonRating(current.lessons, copies, grade) };
    storePracticeSession(sessionStorageIfAvailable(), storageKey, latest.current);
    setSnapshot(latest.current);
    void save();
  }, [mode, save, storageKey]);
  const previous = previousPracticeSession(recentSessions, snapshot?.id);
  const unrated = Object.entries(lessonNames).filter(([id]) => !snapshot?.lessons[id]);
  const summary = snapshot && (
    <section className="w-full rounded-xl border border-border p-3 text-left text-sm">
      <h2 className="font-semibold">{SKILL_NAMES[mode]} by lesson</h2>
      <p className="mt-1 text-xs text-muted">Struggle counts Retry (Again) and Hard ratings. {ATTRIBUTION_NOTE}</p>
      {mode === "pinyin" && <p className="text-xs text-muted">Pinyin is optional practice outside readiness.</p>}
      {!previous && <p className="mt-1 text-xs text-muted">First recorded {SKILL_NAMES[mode].toLowerCase()} session for this group.</p>}
      <ul className="mt-2 divide-y divide-border" role="list">
        {Object.entries(snapshot.lessons).map(([id, counts]) => {
          const rate = struggleRate(counts);
          const change = describeChange(rate, struggleRate(previous?.lessons[id]));
          return <li key={id} className="py-2">
            <h3 className="font-medium break-words">{lessonNames[id] ?? id}</h3>
            <p>{plural(ratingCount(counts), "rating")} · {Math.round(rate! * 100)}% struggle</p>
            {previous && <p className="text-xs text-muted">{change}</p>}
          </li>;
        })}
      </ul>
      {unrated.length > 0 && <details className="mt-1 text-xs text-muted">
        <summary className="cursor-pointer py-2">{plural(unrated.length, "lesson")} with no ratings this session</summary>
        <p>{unrated.map(([, name]) => name).join(", ")}</p>
      </details>}
      {saveState === "saving" && <p className="text-xs text-muted">Saving lesson stats…</p>}
      {saveState === "failed" && <div role="status">
        <p>Lesson stats couldn’t sync. Card ratings sync separately. Retry before leaving to keep this breakdown.</p>
        <button type="button" className="btn btn-secondary mt-1" onClick={save}>Retry lesson stats</button>
      </div>}
    </section>
  );
  const hasRatings = snapshot !== null;
  const source = useMemo<StudySource>(() => ({
    onRating,
    hasRatings,
    onFinish,
    scope: `group:${groupId}:${plan}`,
    url: (includeNew) => groupQueueUrl(groupId, mode, plan, includeNew),
  }), [groupId, mode, plan, onRating, hasRatings, onFinish]);
  const emptyMessage = plan === "all"
    ? "This group has no cards you can practice in this mode."
    : "Nothing in this group is due today. Come back tomorrow, or try extra practice.";
  // deckId is only a label for virtual decks here; the queue comes from `source`.
  const deckId = `group:${groupId}`;
  if (mode === "review") {
    return <ReviewSession deckId={deckId} deckLangs={deckLangs} backHref={backHref} source={source} summary={summary} emptyMessage={emptyMessage} />;
  }
  return <WriteSession mode={mode} deckId={deckId} chineseLang={chineseLang} backHref={backHref} source={source} summary={summary} emptyMessage={emptyMessage} />;
}
