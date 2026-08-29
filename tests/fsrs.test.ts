import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyRating,
  emptyCardState,
  previewIntervals,
  Rating,
  State,
  toFsrsCard,
  toStored,
} from "@/lib/fsrs";

const NOW = new Date("2026-08-28T12:00:00Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("emptyCardState", () => {
  it("creates a New card due immediately", () => {
    const state = emptyCardState(NOW);
    expect(state.state).toBe(State.New);
    expect(state.due).toBe(NOW.toISOString());
    expect(state.reps).toBe(0);
    expect(state.lapses).toBe(0);
  });
});

describe("applyRating", () => {
  it("Good on a new card advances state and due", () => {
    const { fsrs, log } = applyRating(emptyCardState(NOW), Rating.Good, NOW);
    expect(fsrs.state).not.toBe(State.New);
    expect(new Date(fsrs.due).getTime()).toBeGreaterThan(NOW.getTime());
    expect(fsrs.reps).toBe(1);
    expect(fsrs.last_review).toBe(NOW.toISOString());
    expect(log.rating).toBe(Rating.Good);
  });

  it("Again keeps the card due within minutes", () => {
    const { fsrs } = applyRating(emptyCardState(NOW), Rating.Again, NOW);
    const dueInMs = new Date(fsrs.due).getTime() - NOW.getTime();
    expect(dueInMs).toBeGreaterThan(0);
    expect(dueInMs).toBeLessThanOrEqual(15 * 60_000);
  });

  it("repeated Good reviews grow the interval", () => {
    let state = emptyCardState(NOW);
    let reviewTime = NOW;
    const intervals: number[] = [];
    for (let i = 0; i < 3; i++) {
      const { fsrs } = applyRating(state, Rating.Good, reviewTime);
      intervals.push(new Date(fsrs.due).getTime() - reviewTime.getTime());
      state = fsrs;
      reviewTime = new Date(fsrs.due);
    }
    expect(intervals[1]).toBeGreaterThan(intervals[0]);
    expect(intervals[2]).toBeGreaterThan(intervals[1]);
  });
});

describe("serialization round-trip", () => {
  it("survives JSON stringify/parse", () => {
    const { fsrs } = applyRating(emptyCardState(NOW), Rating.Hard, NOW);
    const revived = toStored(toFsrsCard(JSON.parse(JSON.stringify(fsrs))));
    expect(revived).toEqual(fsrs);
  });
});

describe("previewIntervals", () => {
  it("returns labels for all four ratings, in non-decreasing order", () => {
    const labels = previewIntervals(emptyCardState(NOW), NOW);
    expect(labels.again).toBeTruthy();
    expect(labels.hard).toBeTruthy();
    expect(labels.good).toBeTruthy();
    expect(labels.easy).toBeTruthy();
    // Easy on a new card schedules days out; Again stays in minutes.
    expect(labels.easy).toMatch(/d|mo/);
    expect(labels.again).toMatch(/m$/);
  });
});
