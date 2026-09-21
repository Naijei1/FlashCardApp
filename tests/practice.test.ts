import { describe, expect, it } from "vitest";
import { rateCard, weeklyProgress } from "@/lib/practice";
import { buildQueue, dueCards } from "@/lib/due";
import { uniqueWords } from "@/lib/words";
import { emptyCardState, applyRating, previewIntervals, Rating } from "@/lib/fsrs";
import { formatInterval } from "@/lib/interval-label";
import type { Card } from "@/lib/types";
const now = new Date("2026-09-20T12:00:00Z");
const make = (id = "word"): Card => ({ id, deckId: "deck", front: "你好", back: "hello", createdAt: now.toISOString(), updatedAt: now.toISOString(), fsrs: emptyCardState(now) });

describe("one word, one schedule", () => {
  it("keeps exact and reverse duplicates out until the latest review is due, without deleting any data", () => {
    const card = make();
    const rated = rateCard(card, Rating.Easy, now).card;
    const cards = [{ ...card, id: "copy" }, rated, { ...card, id: "reverse", front: card.back, back: card.front }];
    const before = JSON.stringify(cards);
    expect(uniqueWords(cards)).toEqual([rated]);
    expect(dueCards(cards, now)).toEqual([]);
    expect(dueCards(cards, new Date(rated.fsrs.due))).toEqual([rated]);
    expect(JSON.stringify(cards)).toBe(before);
  });
  it("keeps distinct meanings and decks separate", () => {
    expect(uniqueWords([make(), { ...make("other"), back: "greetings" }, { ...make("other-deck"), deckId: "other" }])).toHaveLength(3);
  });
  it("prioritizes frequently failed due words over successful words, without pulling future reviews forward", () => {
    const good = rateCard(make(), Rating.Good, now).card;
    const due = new Date(good.fsrs.due);
    const failed = { ...good, id: "failed", front: "难", practice: { failures: 5, successes: 0, correctStreak: 0 } };
    const future = { ...failed, id: "future", front: "未来", fsrs: { ...failed.fsrs, due: new Date(due.getTime() + 1000).toISOString() } };
    expect(buildQueue([good, failed, future], due, () => 0, 1)).toEqual([failed]);
  });
  it("makes room for 11 new words alongside overdue reviews", () => {
    const reviews = Array.from({ length: 40 }, (_, i) => ({ ...rateCard(make(String(i)), Rating.Good, now).card, front: `review-${i}` }));
    const fresh = Array.from({ length: 20 }, (_, i) => ({ ...make(`new-${i}`), front: `new-${i}` }));
    const queue = buildQueue([...reviews, ...fresh], new Date(reviews[0].fsrs.due));
    expect(queue).toHaveLength(25);
    expect(queue.filter((card) => card.fsrs.reps === 0)).toHaveLength(11);
  });
});

describe("adaptive recall", () => {
  it("remembers repeated failures and correct streaks across serialization", () => {
    let card = make();
    card = rateCard(card, Rating.Again, now).card;
    card = rateCard(JSON.parse(JSON.stringify(card)), Rating.Again, new Date(card.fsrs.due)).card;
    expect(card.practice).toMatchObject({ failures: 2, successes: 0, correctStreak: 0 });
    card = rateCard(card, Rating.Good, new Date(card.fsrs.due)).card;
    card = rateCard(card, Rating.Good, new Date(card.fsrs.due)).card;
    expect(card.practice).toMatchObject({ failures: 2, successes: 2, correctStreak: 2, firstStudiedAt: now.toISOString() });
  });
  it("moves Good/Easy out of the current session, while Retry comes back in a minute", () => {
    for (const grade of [Rating.Good, Rating.Easy] as const) {
      expect(Date.parse(applyRating(make().fsrs, grade, now).fsrs.due) - now.getTime()).toBeGreaterThanOrEqual(86_400_000);
    }
    expect(Date.parse(applyRating(make().fsrs, Rating.Again, now).fsrs.due) - now.getTime()).toBe(60_000);
  });
  it("uses the exact same intervals for all button previews and stored ratings", () => {
    const states = [make().fsrs, applyRating(make().fsrs, Rating.Again, now).fsrs, applyRating(make().fsrs, Rating.Good, now).fsrs];
    for (const state of states) {
      const at = new Date(state.due);
      const labels = previewIntervals(state, at);
      for (const [key, grade] of [["again", 1], ["hard", 2], ["good", 3], ["easy", 4]] as const) {
        expect(formatInterval(Date.parse(applyRating(state, grade, at).fsrs.due) - at.getTime())).toBe(labels[key]);
      }
    }
  });
  it("tracks this week's introduced words once and respects Eastern midnight", () => {
    const a = rateCard(make(), Rating.Good, new Date("2026-09-20T03:30:00Z")).card;
    const b = rateCard({ ...make("b"), front: "老师" }, Rating.Good, now).card;
    expect(weeklyProgress([a, b, { ...a, id: "copy" }], now, "America/New_York")).toEqual({ week: 2, today: 1 });
    expect(weeklyProgress([a, b], new Date("2026-09-21T04:00:00Z"), "America/New_York")).toEqual({ week: 0, today: 0 });
  });
});

it("gives a failed mature word a shorter recovery interval than another successful recall", () => {
  let card = make();
  for (let count = 0; count < 5; count++) card = rateCard(card, Rating.Good, new Date(card.fsrs.due)).card;
  const at = new Date(card.fsrs.due);
  const remembered = rateCard(card, Rating.Good, at).card;
  const missed = rateCard(card, Rating.Again, at).card;
  expect(Date.parse(missed.fsrs.due)).toBeLessThan(Date.parse(remembered.fsrs.due));
  expect(missed.fsrs.lapses).toBeGreaterThan(remembered.fsrs.lapses);
  const relearned = rateCard(missed, Rating.Good, new Date(missed.fsrs.due)).card;
  expect(relearned.fsrs.scheduled_days).toBeLessThan(remembered.fsrs.scheduled_days);
});
