import { forgetting_curve } from "ts-fsrs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dayDiff,
  examCardStatus,
  examClock,
  FINAL_PASS_RECALL,
  forgettingCurve,
  isFinalPass,
  isValidDateKey,
  latestSafeReviewDay,
  newCardsPerDay,
  newQuotaToday,
  parseTargetRecall,
  recallAt,
  zonedTime,
} from "@/lib/exam";
import { applyRating, emptyCardState, forgettingCurveDecay, Rating } from "@/lib/fsrs";
import type { StoredFsrs } from "@/lib/types";

const tz = "America/New_York";
const DAY = 86_400_000;

/** A reviewed card with an exact stability, last reviewed at `last`. */
function reviewed(stability: number, last: string, dueInDays = 30): StoredFsrs {
  return {
    due: new Date(Date.parse(last) + dueInDays * DAY).toISOString(),
    stability,
    difficulty: 5,
    elapsed_days: 0,
    scheduled_days: dueInDays,
    learning_steps: 0,
    reps: 3,
    lapses: 0,
    state: 2,
    last_review: last,
  };
}

afterEach(() => {
  vi.doUnmock("@/lib/fsrs");
  vi.resetModules();
});

describe("calendar helpers", () => {
  it("accepts real calendar dates only", () => {
    expect(isValidDateKey("2026-12-18")).toBe(true);
    expect(isValidDateKey("2028-02-29")).toBe(true);
    expect(isValidDateKey("2026-02-30")).toBe(false);
    expect(isValidDateKey("2026-1-05")).toBe(false);
    expect(isValidDateKey(20261218)).toBe(false);
    expect(dayDiff("2026-11-18", "2026-12-18")).toBe(30);
  });

  it("places the exam at 9am local time, across DST", () => {
    expect(zonedTime("2026-12-18", 9, tz).toISOString()).toBe("2026-12-18T14:00:00.000Z");
    expect(zonedTime("2026-07-01", 9, tz).toISOString()).toBe("2026-07-01T13:00:00.000Z");
  });

  it("counts days left in the local calendar and ends after exam day", () => {
    // 11pm in New York is already the next UTC day.
    const lateEvening = new Date("2026-11-19T04:00:00Z");
    expect(examClock("2026-11-20", lateEvening, tz)?.daysLeft).toBe(2);
    expect(examClock("2026-11-18", lateEvening, tz)?.daysLeft).toBe(0);
    expect(examClock("2026-11-17", lateEvening, tz)).toBeNull();
    expect(examClock(undefined, lateEvening, tz)).toBeNull();
    // On exam day after 9am, recall is predicted for now.
    const afternoon = new Date("2026-11-18T20:00:00Z");
    expect(examClock("2026-11-18", afternoon, tz)?.examAt).toEqual(afternoon);
  });
});

describe("forgetting curve", () => {
  const decay = forgettingCurveDecay();

  it("uses FSRS-6 decay w[20] and matches ts-fsrs", () => {
    expect(decay).toBeCloseTo(0.1542, 4);
    expect(forgettingCurve(10, 10, decay)).toBeCloseTo(0.9, 10);
    for (const [t, s] of [[1, 2], [30, 5], [3, 100]]) {
      expect(forgettingCurve(t, s, decay)).toBeCloseTo(forgetting_curve(decay, t, s), 6);
    }
  });

  it("has no prediction for a card that was never reviewed", () => {
    expect(recallAt(emptyCardState(new Date()), new Date())).toBeNull();
  });
});

describe("exam due and readiness", () => {
  const now = new Date("2026-11-18T15:00:00Z"); // 10am in New York
  const clock = (exam: string) => examClock(exam, now, tz)!;

  it("calls a strong card ready and leaves it alone", () => {
    const strong = reviewed(2000, "2026-11-10T15:00:00Z");
    const status = examCardStatus(strong, "review", clock("2026-12-18"), 0.95, tz);
    expect(status.recallAtExam!).toBeGreaterThan(0.95);
    expect(status).toMatchObject({ ready: true, examDue: false, fsrsDue: false });
  });

  it("waits for the latest safe day, then pulls the card in before FSRS would", () => {
    const weak = reviewed(4, "2026-11-10T15:00:00Z", 60);
    const far = clock("2026-12-18");
    const safe = latestSafeReviewDay(weak, "review", far, 0.95)!;
    expect(safe).toBeGreaterThan(0);
    // A Good review on that day still keeps recall at the exam on target.
    const at = new Date(now.getTime() + safe * DAY);
    const after = applyRating(weak, Rating.Good, at).fsrs;
    expect(forgettingCurve((far.examAt.getTime() - at.getTime()) / DAY, after.stability, forgettingCurveDecay())).toBeGreaterThanOrEqual(0.95);
    expect(examCardStatus(weak, "review", far, 0.95, tz)).toMatchObject({ ready: false, examDue: false });

    // Once the exam is close enough that the safe day is today, it is exam-due
    // although its FSRS due date is still weeks away.
    const soon = clock("2026-11-19");
    expect(latestSafeReviewDay(weak, "review", soon, 0.95)).toBe(0);
    expect(examCardStatus(weak, "review", soon, 0.95, tz)).toMatchObject({ examDue: true, fsrsDue: false });
  });

  it("is not pulled in twice on the day it was reviewed", () => {
    const today = reviewed(0.5, "2026-11-18T14:00:00Z", 1);
    expect(examCardStatus(today, "write", clock("2026-11-19"), 0.95, tz)).toMatchObject({ reviewedToday: true, examDue: false });
  });

  it("final pass: day before and exam day include anything predicted below 97%", () => {
    // Ready for an 85% target but under 97% at the exam.
    const card = reviewed(40, "2026-11-01T15:00:00Z", 60);
    const dayBefore = clock("2026-11-19");
    expect(isFinalPass(dayBefore)).toBe(true);
    const status = examCardStatus(card, "review", dayBefore, 0.85, tz);
    expect(status.ready).toBe(true);
    expect(status.recallAtExam!).toBeLessThan(FINAL_PASS_RECALL);
    expect(status.examDue).toBe(true);
    expect(examCardStatus(card, "review", clock("2026-11-18"), 0.85, tz).examDue).toBe(true);
    // A week out it is ready and not due.
    expect(examCardStatus(card, "review", clock("2026-11-25"), 0.85, tz).examDue).toBe(false);
    // Very strong cards skip the final pass.
    expect(examCardStatus(reviewed(5000, "2026-11-01T15:00:00Z"), "review", dayBefore, 0.85, tz).examDue).toBe(false);
  });

  it("falls back to half the remaining time when the simulation is unavailable", async () => {
    vi.resetModules();
    vi.doMock("@/lib/fsrs", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/lib/fsrs")>()),
      applyRating: () => { throw new Error("no simulation"); },
    }));
    const exam = await import("@/lib/exam");
    const c = exam.examClock("2026-11-28", now, tz)!; // ~10 days away
    const recent = reviewed(4, "2026-11-15T15:00:00Z", 60); // 3 days ago < 10/2
    const old = reviewed(4, "2026-11-10T15:00:00Z", 60); // 8 days ago >= 10/2
    expect(exam.latestSafeReviewDay(recent, "review", c, 0.95)).toBeNull();
    expect(exam.examCardStatus(recent, "review", c, 0.95, tz).examDue).toBe(false);
    expect(exam.examCardStatus(old, "review", c, 0.95, tz).examDue).toBe(true);
  });
});

describe("new cards per day", () => {
  it("spreads unseen cards over the days left minus a buffer", () => {
    expect(newCardsPerDay(100, 10)).toBe(13); // 100 / (10 - 2)
    expect(newCardsPerDay(100, 8)).toBe(17); // 100 / (8 - 2)
    expect(newCardsPerDay(30, 7)).toBe(5); // 30 / (7 - 1)
    expect(newCardsPerDay(30, 2)).toBe(30); // max(1, 2 - 1)
    expect(newCardsPerDay(30, 0)).toBe(30);
    expect(newCardsPerDay(0, 10)).toBe(0);
  });

  it("keeps today's quota fixed as cards are learned", () => {
    expect(newQuotaToday(100, 0, 10)).toBe(13);
    expect(newQuotaToday(95, 5, 10)).toBe(8);
    expect(newQuotaToday(87, 13, 10)).toBe(0);
    expect(newQuotaToday(3, 0, 1)).toBe(3);
  });
});

describe("target recall", () => {
  it("accepts 85%-98%, rounded to a whole percent", () => {
    expect(parseTargetRecall(0.95)).toBe(0.95);
    expect(parseTargetRecall(0.854)).toBe(0.85);
    expect(parseTargetRecall(0.84)).toBeNull();
    expect(parseTargetRecall(0.99)).toBeNull();
    expect(parseTargetRecall("0.9")).toBeNull();
  });
});
