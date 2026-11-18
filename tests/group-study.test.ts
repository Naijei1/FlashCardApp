import { describe, expect, it } from "vitest";
import { emptyCardState, Rating } from "@/lib/fsrs";
import { buildGroupQueue, examTileLine, groupEntries, summarizeGroup } from "@/lib/group-study";
import { rateMode } from "@/lib/modes";
import type { Card, Deck, StoredFsrs } from "@/lib/types";

const tz = "America/New_York";
const at = "2026-10-01T00:00:00.000Z";
const now = new Date("2026-11-18T15:00:00Z"); // 10am New York
const DAY = 86_400_000;

function deck(id: string, name: string, week: number): Deck {
  return { id, name, createdAt: at, updatedAt: at, frontLanguage: "zh-CN", backLanguage: "en-US", source: "global", releaseWeek: week };
}
const l6 = deck("l6", "Lesson 6", 6);
const l8 = deck("l8", "Lesson 8", 8);

function card(id: string, deckId: string, front: string, back: string, fsrs: StoredFsrs = emptyCardState(new Date(at))): Card {
  return { id, deckId, front, back, createdAt: at, updatedAt: at, fsrs };
}

function reviewedState(stability: number, last: string, dueInDays: number): StoredFsrs {
  return {
    due: new Date(Date.parse(last) + dueInDays * DAY).toISOString(),
    stability, difficulty: 5, elapsed_days: 0, scheduled_days: dueInDays, learning_steps: 0,
    reps: 3, lapses: 0, state: 2, last_review: last,
  };
}

const strong = reviewedState(3000, "2026-11-10T15:00:00Z", 400);
const weak = reviewedState(4, "2026-11-10T15:00:00Z", 60);

function fixture() {
  return [
    // 老师 appears in both lessons and as a reversed pair: four copies, one word.
    card("a", "l6", "老师", "teacher", strong),
    card("a-rev", "l6", "teacher", "老师", strong),
    card("a8", "l8", "老师", "teacher"),
    card("b", "l6", "谢谢", "thanks", weak),
    card("c", "l8", "朋友", "friend"),
    card("d", "l8", "学生", "student"),
  ];
}

const ctx = (examDate?: string, targetRecall?: number) => ({
  group: { examDate, targetRecall }, decks: [l6, l8], now, timeZone: tz,
});

describe("summary and Home tile", () => {
  it("counts readiness over recognition + writing only, and today's due + new", () => {
    const entries = groupEntries(fixture(), [l6, l8]);
    expect(entries).toHaveLength(4);
    const summary = summarizeGroup(entries, ctx("2026-11-19"));
    // 老师 is strong in recognition; writing has never been studied.
    expect(summary.exam).toMatchObject({ daysLeft: 1, ready: 1, total: 8, finalPass: true });
    // 谢谢 recognition is exam-due (final pass); 2 unseen recognition + 4 unseen writing, all allowed with 1 day left.
    expect(summary.exam).toMatchObject({ due: 1, newToday: 6 });
    expect(examTileLine(summary.exam!)).toBe("Final in 1 day · 1/8 ready · today: 1 due + 6 new");
    // Pinyin practice is offered but never part of the exam numbers.
    expect(summary.modes.pinyin.total).toBe(4);
  });

  it("spreads new words with the buffer while the exam is far", () => {
    const summary = summarizeGroup(groupEntries(fixture(), [l6, l8]), ctx("2026-11-28"));
    // 10 days left, buffer 2: ceil(2 / 8) = 1 recognition, ceil(4 / 8) = 1 writing.
    expect(summary.exam).toMatchObject({ daysLeft: 10, newToday: 2, due: 0 });
  });

  it("drops the countdown after the exam and goes back to plain FSRS", () => {
    const summary = summarizeGroup(groupEntries(fixture(), [l6, l8]), ctx("2026-11-17"));
    expect(summary.exam).toBeUndefined();
    // Plain FSRS: 谢谢 is not due until January.
    expect(summary.modes.review).toMatchObject({ due: 0, newToday: 2 });
  });
});

describe("group queue", () => {
  it("pulls an exam-due card early, with every duplicate copy attached", () => {
    const entries = groupEntries(fixture(), [l6, l8]);
    const today = buildGroupQueue(entries, { ...ctx("2026-11-19"), mode: "review", plan: "today", random: () => 0 });
    const xiexie = today.queue.find((item) => item.card.front === "谢谢")!;
    expect(xiexie.readyAt).toBe(now.toISOString());
    expect(Date.parse(xiexie.card.fsrs.due)).toBeGreaterThan(now.getTime());
    expect(today.totalDue).toBe(3);
    expect(today.queue.map((item) => item.card.front)).not.toContain("老师");

    const all = buildGroupQueue(entries, { ...ctx(), mode: "review", plan: "all", random: () => 0 });
    expect(all.queue).toHaveLength(4);
    const laoshi = all.queue.find((item) => item.card.front === "老师")!;
    expect(laoshi.copies).toEqual([
      { deckId: "l6", id: "a" }, { deckId: "l6", id: "a-rev" }, { deckId: "l8", id: "a8" },
    ]);
    expect(all.queue.every((item) => item.readyAt === undefined || item.readyAt === now.toISOString())).toBe(true);
  });

  it("uses the freshest copy's memory for a merged word", () => {
    const cards = fixture();
    // Only the Lesson 8 copy has been studied in writing.
    cards[2] = rateMode(cards[2], "write", Rating.Good, new Date(now.getTime() - 3 * DAY)).card;
    const all = buildGroupQueue(groupEntries(cards, [l6, l8]), { ...ctx(), mode: "write", plan: "all" });
    const laoshi = all.queue.find((item) => item.card.front === "老师")!;
    expect(laoshi.card.id).toBe("a");
    expect(laoshi.card.fsrs.reps).toBe(1);
  });

  it("does not refill today's new quota after learning some", () => {
    const cards = fixture();
    const entriesBefore = groupEntries(cards, [l6, l8]);
    const first = buildGroupQueue(entriesBefore, { ...ctx("2026-12-18"), mode: "review", plan: "today" });
    expect(first.totalDue).toBe(1);
    const learned = first.queue[0].card;
    const updated = cards.map((c) => c.id === learned.id ? rateMode(c, "review", Rating.Good, now).card : c);
    const second = buildGroupQueue(groupEntries(updated, [l6, l8]), { ...ctx("2026-12-18"), mode: "review", plan: "today" });
    expect(second.queue.filter((item) => item.card.fsrs.state === 0)).toHaveLength(0);
    expect(second.remainingNew).toBe(1);
    // "Learn more" still lets the learner go beyond the plan.
    const more = buildGroupQueue(groupEntries(updated, [l6, l8]), { ...ctx("2026-12-18"), mode: "review", plan: "today", extendNew: true });
    expect(more.queue.filter((item) => item.card.fsrs.state === 0)).toHaveLength(1);
  });
  it("keeps a supplied reading from the meaning side in session details", () => {
    const cards = [card("x", "l6", "行", "háng — profession")];
    const entries = groupEntries(cards, [l6]);
    const { queue } = buildGroupQueue(entries, { ...ctx(), mode: "pinyin", plan: "all" });
    expect(queue[0].pinyin?.syllables).toEqual(["háng"]);
  });

  it("counts writing starts on a legacy recognition card toward today's allowance", () => {
    const legacy = (id: string, front: string, back: string) =>
      card(id, "l6", front, back, reviewedState(30, "2026-11-01T15:00:00Z", 30));
    const cards = [legacy("p", "老师", "teacher"), legacy("q", "朋友", "friend"), legacy("r", "学生", "student")];
    const plan = (list: Card[]) => buildGroupQueue(groupEntries(list, [l6]), { ...ctx("2026-12-18"), mode: "write", plan: "today" });
    const first = plan(cards);
    const started = first.queue.find((item) => item.card.fsrs.state === 0)!;
    const updated = cards.map((c) => c.id === started.card.id ? rateMode(c, "write", Rating.Good, now).card : c);
    const second = plan(updated);
    expect(second.queue.filter((item) => item.card.fsrs.state === 0)).toHaveLength(first.queue.filter((item) => item.card.fsrs.state === 0).length - 1);
  });
});
