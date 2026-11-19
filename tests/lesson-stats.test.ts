import { expect, it } from "vitest";
import { emptyCardState, Rating, State } from "@/lib/fsrs";
import { addLessonRating, classifyReadiness, compareStruggle, recentStruggle, struggleRate, type Counts, type PracticeSession } from "@/lib/lesson-stats";

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
  expect(stats).toEqual({ trend: [1, null, 1, 0.5, 0], ratings: 14, rate: 3 / 14 });
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
