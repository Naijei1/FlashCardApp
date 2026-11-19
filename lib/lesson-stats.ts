import { recallAt, type ExamMode } from "./exam";
import { forgettingCurveDecay, State, type Grade } from "./fsrs";
import type { ReviewMode, StoredFsrs } from "./types";

export const HISTORY_WINDOW = 5;
export const SKILL_NAMES = { review: "Recognition", write: "Writing", pinyin: "Pinyin practice" };
export const ATTRIBUTION_NOTE = "A shared word counts once in each lesson it belongs to for every rating.";

/** FSRS grade order: Again, Hard, Good, Easy. Each session practices one skill. */
export type Counts = [number, number, number, number];
export type LessonCounts = Record<string, Counts>;
export type PracticeSession = { id: string; startedAt: string; mode: ReviewMode; lessons: LessonCounts };
export type Readiness = { shaky: number; solid: number; unseen: number };

export function lessonIds(copies: readonly { deckId: string }[]): Set<string> {
  return new Set(copies.map((copy) => copy.deckId));
}

export function addLessonRating(lessons: LessonCounts, copies: readonly { deckId: string }[], grade: Grade): LessonCounts {
  const next = { ...lessons };
  for (const id of lessonIds(copies)) {
    const counts: Counts = [...(lessons[id] ?? [0, 0, 0, 0])];
    counts[grade - 1]++;
    next[id] = counts;
  }
  return next;
}

export function ratingCount(counts: Counts): number {
  return counts.reduce((a, b) => a + b, 0);
}

export function struggleRate(counts?: Counts): number | null {
  const total = counts && ratingCount(counts);
  return counts && total ? (counts[0] + counts[1]) / total : null;
}

export function compareStruggle(current: Counts, previous?: Counts) {
  const rate = struggleRate(current);
  const from = struggleRate(previous);
  return { rate, from, delta: rate === null || from === null ? null : rate - from };
}

/** Pool individual ratings. Keep a gap when the lesson was skipped in a session. */
export function recentStruggle(sessions: readonly PracticeSession[], lesson: string, mode: ExamMode) {
  const recent = sessions.filter((s) => s.mode === mode)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id)).slice(-HISTORY_WINDOW);
  const total: Counts = [0, 0, 0, 0];
  const trend = recent.map((s) => {
    const counts = s.lessons[lesson];
    counts?.forEach((n, i) => { total[i] += n; });
    return struggleRate(counts);
  });
  return { trend, rate: struggleRate(total), ratings: ratingCount(total) };
}

export function classifyReadiness(fsrs: StoredFsrs, mode: ExamMode, now: Date, target: number): keyof Readiness {
  if (fsrs.state === State.New) return "unseen";
  const recall = recallAt(fsrs, now, forgettingCurveDecay(mode));
  return fsrs.state === State.Review && recall !== null && recall >= target ? "solid" : "shaky";
}
