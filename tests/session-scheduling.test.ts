import { describe, expect, it } from "vitest";
import {
  SESSION_HORIZON_MS,
  belongsInCurrentSession,
  canAcceptRating,
  firstReadyIndex,
  nextQueuedDue,
  queuedDueAt,
} from "@/lib/session-scheduling";

function item(due: number | string) {
  return { card: { fsrs: { due: typeof due === "number" ? new Date(due).toISOString() : due } } };
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
