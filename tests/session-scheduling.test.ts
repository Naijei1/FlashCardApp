import { describe, expect, it } from "vitest";
import {
  SESSION_HORIZON_MS,
  belongsInCurrentSession,
  canAcceptRating,
  firstReadyIndex,
  nextQueuedDue,
  pickReadyIndex,
  queuedDueAt,
  readyIndexes,
  studyItemKey,
} from "@/lib/session-scheduling";

function item(due: number | string, id = "card") {
  return { card: { id, deckId: "deck", fsrs: { due: typeof due === "number" ? new Date(due).toISOString() : due } } };
}

describe("same-session scheduling", () => {
  it("skips a parked learning card when another card is ready", () => {
    const now = Date.parse("2026-01-01T00:00:00.000Z");
    const queue = [item(now + 60_000), item(now - 1), item(now + 10_000)];

    expect(firstReadyIndex(queue, now)).toBe(1);
    expect(nextQueuedDue(queue, now)).toBe(now + 10_000);
  });

  it("returns no ready index while every learning card is early", () => {
    const now = Date.parse("2026-01-01T00:00:00.000Z");
    const queue = [item(now + 60_000), item(now + 10_000)];

    expect(firstReadyIndex(queue, now)).toBe(-1);
    expect(nextQueuedDue(queue, now)).toBe(now + 10_000);
  });

  it("keeps only cards due within the 15-minute session horizon", () => {
    const now = Date.parse("2026-01-01T00:00:00.000Z");

    expect(belongsInCurrentSession(new Date(now + SESSION_HORIZON_MS).toISOString(), now)).toBe(
      true
    );
    expect(
      belongsInCurrentSession(new Date(now + SESSION_HORIZON_MS + 1).toISOString(), now)
    ).toBe(false);
    expect(belongsInCurrentSession("not-a-date", now)).toBe(false);
  });

  it("surfaces an invalid stored due date instead of parking forever", () => {
    const malformed = item("not-a-date");
    expect(queuedDueAt(malformed)).toBe(0);
    expect(firstReadyIndex([malformed], Date.now())).toBe(0);
  });

  it("accepts the first rating immediately and debounces only later ratings", () => {
    expect(canAcceptRating(null, 10)).toBe(true);
    expect(canAcceptRating(10, 259)).toBe(false);
    expect(canAcceptRating(10, 260)).toBe(true);
  });
});

describe("random eligible pick", () => {
  const now = Date.parse("2026-01-01T00:00:00.000Z");

  it("only draws from cards that are due now", () => {
    const queue = [item(now + 60_000, "waiting"), item(now, "ready-a"), item(now - 1, "ready-b")];
    expect(readyIndexes(queue, now).map((index) => queue[index].card.id).sort()).toEqual(["ready-a", "ready-b"]);
    for (const seed of [0, 0.4, 0.99]) {
      const picked = pickReadyIndex(queue, now, { random: () => seed });
      expect(["ready-a", "ready-b"]).toContain(queue[picked].card.id);
    }
  });

  it("does not show a waiting card early when nothing else is due", () => {
    const queue = [item(now + 60_000, "waiting"), item(now + 10_000, "later")];
    expect(pickReadyIndex(queue, now, { random: () => 0 })).toBe(-1);
    expect(pickReadyIndex(queue, now + 10_000, { random: () => 0 })).toBe(1);
  });

  it("avoids the same card twice in a row when another eligible card exists", () => {
    const queue = [item(now, "a"), item(now, "b"), item(now, "c")];
    const avoid = studyItemKey(queue[0]);
    for (const seed of [0, 0.5, 0.99]) {
      expect(queue[pickReadyIndex(queue, now, { random: () => seed, avoidKey: avoid })].card.id).not.toBe("a");
    }
  });

  it("repeats the only remaining eligible card", () => {
    const queue = [item(now + 60_000, "waiting"), item(now, "solo")];
    expect(queue[pickReadyIndex(queue, now, { random: () => 0, avoidKey: studyItemKey(queue[1]) })].card.id).toBe("solo");
  });

  it("keeps the visible card instead of jumping to another eligible one", () => {
    const queue = [item(now, "a"), item(now, "b")];
    expect(pickReadyIndex(queue, now, { random: () => 0.99, currentKey: studyItemKey(queue[0]) })).toBe(0);
  });

  it("varies the chosen card across seeds", () => {
    const queue = [item(now, "a"), item(now, "b"), item(now, "c"), item(now, "d")];
    const ids = [0, 0.25, 0.5, 0.75].map((seed) => queue[pickReadyIndex(queue, now, { random: () => seed })].card.id);
    expect(new Set(ids).size).toBeGreaterThan(1);
  });
});
