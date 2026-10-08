import { describe, expect, it } from "vitest";
import { emptyCardState, Rating } from "@/lib/fsrs";
import { buildMistakeClinicQueue } from "@/lib/mistake-clinic-queue";
import { weakWords } from "@/lib/mistake-clinic";
import { rateMode } from "@/lib/modes";
import { rateCard, weeklyProgress } from "@/lib/practice";
import type { Card } from "@/lib/types";

const now = new Date("2026-10-08T12:00:00.000Z");

function make(id: string, front = "你好", back = "hello"): Card {
  return {
    id,
    deckId: "lesson",
    front,
    back,
    createdAt: "2026-10-01T12:00:00.000Z",
    updatedAt: "2026-10-01T12:00:00.000Z",
    fsrs: emptyCardState(new Date("2026-10-01T12:00:00.000Z")),
  };
}

describe("Mistake Clinic weak-word selection", () => {
  it("selects hard, lapsed, and repeatedly failed words without pulling in healthy cards", () => {
    let healthy = make("healthy", "老师", "teacher");
    for (let count = 0; count < 4; count++) {
      healthy = rateCard(healthy, Rating.Good, new Date(healthy.fsrs.due)).card;
    }
    const failed = {
      ...make("failed", "难", "difficult"),
      practice: { failures: 3, successes: 1, correctStreak: 0, firstStudiedAt: "2026-10-02T12:00:00.000Z" },
    };
    const lapsed = rateCard(rateCard(make("lapsed", "学习", "study"), Rating.Good, now).card, Rating.Again, new Date("2026-10-08T12:10:00.000Z")).card;
    const hard = { ...make("hard", "水", "water"), hard: true };

    const words = weakWords([healthy, failed, lapsed, hard], { now: new Date("2026-10-08T12:20:00.000Z") });

    expect(words.map((word) => word.card.id)).toEqual(["lapsed", "failed", "hard"]);
    expect(words.find((word) => word.card.id === "failed")?.modes[0].reasons).toContain("3 failures");
    expect(words.find((word) => word.card.id === "hard")?.modes[0].reasons).toContain("marked hard");
  });

  it("builds a mixed prompt queue for the weakest words while keeping real review modes", () => {
    const card = {
      ...make("weak"),
      hard: true,
      modes: {
        write: {
          fsrs: emptyCardState(new Date("2026-10-01T12:00:00.000Z")),
          practice: { failures: 2, successes: 0, correctStreak: 0 },
        },
        pinyin: {
          fsrs: emptyCardState(new Date("2026-10-01T12:00:00.000Z")),
          practice: { failures: 1, successes: 0, correctStreak: 0 },
        },
      },
      practice: { failures: 2, successes: 0, correctStreak: 0 },
    } satisfies Card;

    const data = buildMistakeClinicQueue([card], () => "front", now);

    expect(data.totalWeak).toBe(1);
    expect(data.queue.map((item) => item.mode).sort()).toEqual(["pinyin", "review", "write"]);
    expect(data.queue.every((item) => item.card.id === "weak" && item.weaknessReasons.length > 0)).toBe(true);
  });

  it("orders dedicated weak skills as recognition, then write, then pinyin", () => {
    const fresh = emptyCardState(now);
    const review = {
      ...make("e2e-clinic-review", "忘记", "to forget"),
      fsrs: { ...fresh, reps: 6, lapses: 5, state: 3, last_review: now.toISOString() },
      practice: { failures: 2, successes: 3, correctStreak: 0, firstStudiedAt: "2026-09-20T12:00:00.000Z" },
    } satisfies Card;
    const write = {
      ...make("e2e-clinic-write", "难", "difficult"),
      modes: {
        write: {
          fsrs: fresh,
          practice: { failures: 8, successes: 0, correctStreak: 0, firstStudiedAt: "2026-09-20T12:00:00.000Z" },
        },
      },
    } satisfies Card;
    const pinyin = {
      ...make("e2e-clinic-pinyin", "学习", "to study"),
      modes: {
        pinyin: {
          fsrs: fresh,
          practice: { failures: 5, successes: 0, correctStreak: 0, firstStudiedAt: "2026-09-20T12:00:00.000Z" },
        },
      },
    } satisfies Card;

    const data = buildMistakeClinicQueue([review, write, pinyin], () => "front", now);
    expect(data.queue.map((item) => item.mode)).toEqual(["review", "write", "pinyin"]);
    expect(data.queue.map((item) => item.card.front)).toEqual(["忘记", "难", "学习"]);
  });
});

describe("Mistake Clinic review recording", () => {
  it("records a clinic writing prompt only in that skill schedule and keeps weekly words unique", () => {
    const original = {
      ...rateCard(make("word"), Rating.Good, new Date("2026-10-07T12:00:00.000Z")).card,
      modes: {
        write: {
          fsrs: emptyCardState(new Date("2026-10-01T12:00:00.000Z")),
          practice: { failures: 2, successes: 0, correctStreak: 0, firstStudiedAt: "2026-10-07T12:00:00.000Z" },
        },
      },
    } satisfies Card;
    const recognitionBefore = original.fsrs;

    const saved = rateMode(original, "write", Rating.Again, now).card;

    expect(saved.fsrs).toEqual(recognitionBefore);
    expect(saved.modes?.write?.fsrs.reps).toBe(1);
    expect(saved.modes?.write?.practice).toMatchObject({ failures: 3, successes: 0, correctStreak: 0 });
    expect(weeklyProgress([saved], now, "America/New_York")).toEqual({ week: 1, today: 0 });
  });
});
