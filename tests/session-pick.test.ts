import { describe, expect, it } from "vitest";
import { shuffle } from "@/lib/due";
import { emptyCardState, Rating } from "@/lib/fsrs";
import { buildMistakeClinicQueue } from "@/lib/mistake-clinic-queue";
import { cardForMode } from "@/lib/modes";
import { belongsInCurrentSession, pickIndex, pickReadyIndex, studyItemKey } from "@/lib/session-scheduling";
import { rateCard } from "@/lib/practice";
import { buildStudyQueue } from "@/lib/pinyin-queue";
import type { StudyQueueItem } from "@/lib/review-queue";
import type { Card, ReviewMode } from "@/lib/types";

const NOW = new Date("2026-10-08T12:00:00.000Z");

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCard(id: string, front = "你好", back = "hello"): Card {
  return {
    id,
    deckId: "deck",
    front,
    back,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    fsrs: emptyCardState(NOW),
  };
}

function drain(queue: StudyQueueItem[], now: number, random: () => number): string[] {
  const order: string[] = [];
  let items = [...queue];
  let avoidKey: string | null = null;
  while (items.length > 0) {
    const index = pickReadyIndex(items, now, { random, avoidKey, keyOf: studyItemKey });
    if (index < 0) break;
    const item = items[index];
    order.push(`${item.card.id}:${item.card.front}`);
    avoidKey = studyItemKey(item);
    items = items.filter((_, i) => i !== index);
  }
  return order;
}

function walkAfterAgain(queue: StudyQueueItem[], now: Date, random: () => number, mode: ReviewMode, ratings: number): string[] {
  const seen: string[] = [];
  let items = [...queue];
  let at = now.getTime();
  let avoidKey: string | null = null;
  for (let step = 0; step < ratings; step++) {
    const index = pickReadyIndex(items, at, { random, avoidKey, keyOf: studyItemKey });
    if (index < 0) {
      const waiting = items.map((item) => new Date(item.card.fsrs.due).getTime()).filter((due) => due > at);
      if (waiting.length === 0) break;
      at = Math.min(...waiting);
      continue;
    }
    const item = items[index];
    seen.push(item.card.id);
    const rated = rateCard(item.card, Rating.Again, new Date(at), mode);
    const rest = [...items.slice(0, index), ...items.slice(index + 1)];
    items = belongsInCurrentSession(rated.card.fsrs.due, at) ? [...rest, { ...item, card: rated.card }] : rest;
    avoidKey = studyItemKey(item);
  }
  return seen;
}

describe("session next-card pick for every study mode", () => {
  const modes: ReviewMode[] = ["review", "write", "pinyin"];

  it.each(modes)("builds a shuffled %s queue and only serves currently due cards", (mode) => {
    const cards = ["a", "b", "c", "d", "e"].map((id) => cardForMode(makeCard(id, "你好", id), mode));
    const later = rateCard(cardForMode(makeCard("later", "谢谢", "thanks"), mode), Rating.Easy, NOW, mode).card;
    const first = buildStudyQueue([...cards, later], { mode, sideFor: () => "front", now: NOW, random: mulberry32(1) });
    const second = buildStudyQueue([...cards, later], { mode, sideFor: () => "front", now: NOW, random: mulberry32(2) });

    expect(first.queue.map((item) => item.card.id).sort()).toEqual(["a", "b", "c", "d", "e"]);
    expect(first.queue.map((item) => item.card.id)).not.toEqual(second.queue.map((item) => item.card.id));

    const now = NOW.getTime();
    const served = drain(first.queue, now, mulberry32(3));
    expect(served).toHaveLength(5);
    expect(served.join()).not.toContain("later");
    expect(new Set(served).size).toBe(5);
  });

  it.each(modes)("does not replay the same %s card back-to-back after Again when another card is due", (mode) => {
    const cards = ["one", "two", "three"].map((id) => cardForMode(makeCard(id, "你好", id), mode));
    const { queue } = buildStudyQueue(cards, { mode, sideFor: () => "front", now: NOW, random: () => 0 });
    const seen = walkAfterAgain(queue, NOW, mulberry32(11), mode, 6);
    expect(seen.length).toBeGreaterThan(3);
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i], `repeat at ${i}: ${seen.join(",")}`).not.toBe(seen[i - 1]);
    }
  });

  it.each(modes)("keeps a parked %s card hidden until its wait is over", (mode) => {
    const ready = cardForMode(makeCard("ready", "你好", "ready"), mode);
    const parked = rateCard(cardForMode(makeCard("parked", "谢谢", "parked"), mode), Rating.Again, NOW, mode).card;
    const queue: StudyQueueItem[] = [
      { card: parked },
      { card: ready },
    ];
    const at = NOW.getTime();
    expect(queue[pickReadyIndex(queue, at, { random: () => 0 })].card.id).toBe("ready");
    expect(pickReadyIndex([queue[0]], at, { random: () => 0 })).toBe(-1);
    const due = Date.parse(parked.fsrs.due);
    expect(queue[0].card.id).toBe("parked");
    expect(pickReadyIndex([queue[0]], due, { random: () => 0 })).toBe(0);
  });
});

describe("Mistake Clinic random serving", () => {
  it("selects the weakest prompts then serves them in seed-dependent order without back-to-back repeats of the same word", () => {
    const cards = ["one", "two", "three"].map((id) => ({
      ...makeCard(id, id === "one" ? "忘记" : id === "two" ? "难" : "学习", id),
      hard: true,
      practice: { failures: 4, successes: 0, correctStreak: 0, firstStudiedAt: "2026-09-20T12:00:00.000Z" },
    }));
    const first = buildMistakeClinicQueue(cards, () => "front", NOW, { random: mulberry32(4) });
    const second = buildMistakeClinicQueue(cards, () => "front", NOW, { random: mulberry32(5) });
    expect(first.queue.map((item) => `${item.card.id}:${item.mode}`).sort()).toEqual(
      second.queue.map((item) => `${item.card.id}:${item.mode}`).sort()
    );
    expect(first.queue.map((item) => `${item.card.id}:${item.mode}`)).not.toEqual(
      second.queue.map((item) => `${item.card.id}:${item.mode}`)
    );

    const seen: string[] = [];
    let items = [...first.queue];
    let avoidKey: string | null = null;
    const random = mulberry32(8);
    while (items.length > 0) {
      const index = pickIndex(items, items.map((_, i) => i), { random, avoidKey, keyOf: studyItemKey });
      const item = items[index];
      seen.push(item.card.id);
      avoidKey = studyItemKey(item);
      items = items.filter((_, i) => i !== index);
    }
    const uniqueWords = new Set(cards.map((card) => card.id));
    for (let i = 1; i < seen.length; i++) {
      if (uniqueWords.size > 1 && seen.slice(i).some((id) => id !== seen[i - 1])) {
        expect(seen[i]).not.toBe(seen[i - 1]);
      }
    }
  });
});

describe("Normal Review shuffle", () => {
  it("starts in a seed-dependent order without dropping cards", () => {
    const indexes = [0, 1, 2, 3, 4];
    const first = shuffle(indexes, mulberry32(9));
    const second = shuffle(indexes, mulberry32(10));
    expect([...first].sort((a, b) => a - b)).toEqual(indexes);
    expect(first).not.toEqual(second);
    expect(first).not.toEqual(indexes);
  });
});
