import { describe, it, expect } from "vitest";
import { fsrs, generatorParameters, Rating } from "ts-fsrs";
import { emptyCardState, currentRetentionSchedule, applyRating, toFsrsCard } from "@/lib/fsrs";
import { cardForMode, rateMode } from "@/lib/modes";
import { buildReviewQueueData } from "@/lib/review-queue";
import { weeklyProgress } from "@/lib/practice";
import type { Card, ReviewMode } from "@/lib/types";
const now = new Date("2026-09-21T12:00:00Z");
const make = (): Card => ({ id: "a", deckId: "d", front: "你好", back: "hello", createdAt: now.toISOString(), updatedAt: now.toISOString(), fsrs: emptyCardState(now) });
const modes: ReviewMode[] = ["review", "write", "pinyin"];
describe("independent skill queues", () => {
  it.each(modes)("a successful %s review leaves the other skills due", (mode) => {
    const updated = JSON.parse(JSON.stringify(rateMode(make(), mode, Rating.Good, now).card));
    for (const skill of modes) {
      const projected = cardForMode(updated, skill);
      expect(projected.fsrs.reps).toBe(skill === mode ? 1 : 0);
      expect(buildReviewQueueData([projected], now).queue).toHaveLength(skill === mode ? 0 : 1);
    }
  });
  it("keeps failures and streaks isolated across alternating modes", () => {
    let card = rateMode(make(), "review", Rating.Easy, now).card;
    card = rateMode(card, "write", Rating.Again, now).card;
    card = rateMode(card, "pinyin", Rating.Good, now).card;
    expect(card.practice?.correctStreak).toBe(1);
    expect(card.modes?.write?.practice?.failures).toBe(1);
    expect(card.modes?.pinyin?.practice?.failures).toBe(0);
    expect(card.modes?.write?.fsrs.due).not.toBe(card.modes?.pinyin?.fsrs.due);
  });
  it("deduplicates each mode using its own latest copy", () => {
    const written = rateMode(make(), "write", Rating.Good, now).card;
    const recognized = rateMode({ ...make(), id: "b", front: "hello", back: "你好" }, "review", Rating.Good, now).card;
    for (const skill of modes) expect(buildReviewQueueData([written, recognized].map((c) => cardForMode(c, skill)), now).queue).toHaveLength(skill === "pinyin" ? 1 : 0);
  });
  it("counts a word introduced in multiple modes and duplicate copies only once", () => {
    const a = rateMode(make(), "write", Rating.Good, now).card;
    const b = rateMode({ ...make(), id: "b" }, "pinyin", Rating.Good, now).card;
    expect(weeklyProgress([a, b], now, "America/New_York")).toEqual({ week: 1, today: 1 });
  });
});
describe("shorter retention intervals", () => {
  it("uses shorter mature-card intervals at 95% than at 90%", () => {
    const state = { ...make().fsrs, state: 2, stability: 40, difficulty: 5, reps: 8, last_review: new Date(now.getTime() - 30 * 86400000).toISOString() };
    const old = fsrs(generatorParameters({ request_retention: .9, enable_fuzz: false }));
    expect(applyRating(state, Rating.Good, now).fsrs.scheduled_days).toBeLessThan(old.next(toFsrsCard(state), now, Rating.Good).card.scheduled_days);
  });
  it("brings existing long schedules forward once without rewriting review history", () => {
    const state = { ...make().fsrs, retentionTarget: undefined, state: 2, stability: 40, reps: 8, last_review: now.toISOString(), due: new Date(+now + 40 * 86400000).toISOString(), scheduled_days: 40 };
    const adjusted = currentRetentionSchedule(state);
    expect(adjusted.scheduled_days).toBeLessThan(40);
    expect(adjusted.reps).toBe(8);
    expect(adjusted.last_review).toBe(state.last_review);
    expect(currentRetentionSchedule(adjusted)).toEqual(adjusted);
    expect(state.scheduled_days).toBe(40);
  });
});

it("does not count legacy known vocabulary as new when starting writing", () => {
  const old = { ...make(), fsrs: { ...make().fsrs, reps: 4, state: 2 } };
  const written = rateMode(old, "write", Rating.Good, now).card;
  expect(weeklyProgress([written], now, "America/New_York")).toEqual({ week: 0, today: 0 });
});
