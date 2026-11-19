import { expect, it } from "vitest";
import { emptyCardState, Rating, State } from "@/lib/fsrs";
import { addLessonRating, classifyReadiness, compareStruggle, describeChange, loadPracticeSession, practiceSessionKey, previousPracticeSession, recentStruggle, storePracticeSession, struggleLevel, struggleRate, type Counts, type PracticeSession } from "@/lib/lesson-stats";

it("credits one rating to every distinct lesson of a merged word, including repeated attempts", () => {
  const copies = [{ deckId: "a" }, { deckId: "a" }, { deckId: "b" }];
  const first = addLessonRating({}, copies, Rating.Again);
  expect(addLessonRating(first, copies, Rating.Easy)).toEqual({ a: [1, 0, 0, 1], b: [1, 0, 0, 1] });
  expect(first.a).toEqual([1, 0, 0, 0]);
});

it("counts Again and Hard and distinguishes no ratings from zero struggle", () => {
  expect(struggleRate([2, 1, 5, 2])).toBe(0.3);
  expect(struggleRate([0, 0, 0, 1])).toBe(0);
  expect(struggleRate([0, 0, 0, 0])).toBeNull();
});

it("compares the same lesson's counts and handles a missing baseline", () => {
  expect(compareStruggle([0, 2, 2, 1], [1, 2, 2, 0]).delta).toBeCloseTo(-0.2);
  expect(compareStruggle([0, 2, 2, 1]).delta).toBeNull();
});

it("orders the last five sessions per skill, preserving gaps and weighting each rating equally", () => {
  function session(day: number, counts?: Counts, mode: PracticeSession["mode"] = "review"): PracticeSession {
    return { id: `${day}`, startedAt: `2026-11-0${day}T00:00:00.000Z`, mode, lessons: counts ? { a: counts } : {} };
  }
  const stats = recentStruggle([
    session(6, [0, 0, 10, 0]), session(2, [1, 0, 0, 0]), session(1, [99, 0, 0, 0]),
    session(3), session(5, [1, 0, 1, 0]), session(4, [0, 1, 0, 0]), session(7, [99, 0, 0, 0], "pinyin"),
  ], "a", "review");
  expect(stats).toEqual({ sessionCount: 5, rate: 3 / 14, latestRate: 0, change: describeChange(0, 0.75) });
});

it("keeps learning and relearning shaky even with fresh memory; applies the current recall target to review cards", () => {
  const now = new Date("2026-11-19T00:00:00Z");
  const fresh = emptyCardState(now);
  const memory = { ...fresh, reps: 4, stability: 10, last_review: "2026-11-09T00:00:00Z", state: State.Review };
  expect(classifyReadiness(fresh, "write", now, 0.95)).toBe("unseen");
  expect(classifyReadiness(memory, "write", now, 0.85)).toBe("solid");
  expect(classifyReadiness(memory, "write", now, 0.95)).toBe("shaky");
  for (const state of [State.Learning, State.Relearning]) {
    expect(classifyReadiness({ ...memory, state, last_review: now.toISOString() }, "review", now, 0.85)).toBe("shaky");
  }
});


it("describes changes using the displayed percentages", () => {
  expect(describeChange(1 / 3, 0.334)?.chip).toBe("= same");
  expect(describeChange(0.25, 1 / 3)?.chip).toBe("↓ from 33%");
  expect(describeChange(0.5, 1 / 3)?.chip).toBe("↑ from 33%");
  expect(describeChange(0.5, null)).toBeNull();
});

it("classifies the displayed percentage, keeping an unrated lesson neutral", () => {
  expect([null, 0, 0.19, 0.199, 0.2, 0.39, 0.4, 1].map(struggleLevel))
    .toEqual(["unrated", "low", "low", "medium", "medium", "medium", "high", "high"]);
});

it("keeps pooled ratings without a trend when the latest session skips the lesson", () => {
  const history: PracticeSession[] = [
    { id: "1", startedAt: "2026-11-01", mode: "write", lessons: { a: [1, 0, 1, 0] } },
    { id: "2", startedAt: "2026-11-02", mode: "write", lessons: {} },
  ];
  expect(recentStruggle(history, "a", "write")).toMatchObject({ rate: 0.5, change: null, latestRate: null });
});

it("resumes only fresh sessions for the same group and skill", () => {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
  const saved: PracticeSession = { id: "s2", startedAt: "2026-11-18T15:00:00.000Z", mode: "review", lessons: { l6: [1, 0, 2, 0] } };
  const key = practiceSessionKey("g1", "review");
  const now = Date.parse(saved.startedAt);
  storePracticeSession(storage, key, saved);
  expect(loadPracticeSession(storage, key, "review", now)).toEqual(saved);
  expect(loadPracticeSession(storage, key, "review", now + 12 * 60 * 60 * 1000 + 1)).toBeNull();
  expect(loadPracticeSession(storage, practiceSessionKey("g2", "review"), "review", now)).toBeNull();
  expect(loadPracticeSession(storage, practiceSessionKey("g1", "write"), "write", now)).toBeNull();
  expect(loadPracticeSession({ ...storage, getItem: () => { throw new Error(); } }, key, "review", now)).toBeNull();
  const previous = { ...saved, id: "s1" };
  expect(previousPracticeSession([saved, previous], saved.id)).toBe(previous);
  storePracticeSession(storage, key, null);
  expect(loadPracticeSession(storage, key, "review", now)).toBeNull();
});
