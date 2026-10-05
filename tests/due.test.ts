import { describe, expect, it } from "vitest";
import { buildQueue, countsByDeck, isDue, isNew, totalCounts } from "@/lib/due";
import { applyRating, emptyCardState, Rating } from "@/lib/fsrs";
import type { Card, StoredFsrs } from "@/lib/types";

const NOW = new Date("2026-08-28T12:00:00Z");

function makeCard(overrides: Partial<Card> & { fsrs?: StoredFsrs } = {}): Card {
  return {
    id: overrides.id ?? "card-1",
    deckId: overrides.deckId ?? "deck-1",
    front: overrides.id ?? "你好",
    back: "hello",
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    fsrs: overrides.fsrs ?? emptyCardState(NOW),
    ...overrides,
  };
}

describe("isDue", () => {
  it("is due when due date equals now (boundary)", () => {
    expect(isDue(makeCard(), NOW)).toBe(true);
  });

  it("is due when overdue", () => {
    expect(isDue(makeCard(), new Date(NOW.getTime() + 1000))).toBe(true);
  });

  it("is not due when due in the future", () => {
    const { fsrs } = applyRating(emptyCardState(NOW), Rating.Easy, NOW);
    expect(isDue(makeCard({ fsrs }), NOW)).toBe(false);
  });
});

describe("corrupt schedules", () => {
  it("treats an unreadable due date as due so the word is not lost", () => {
    const fsrs = { ...applyRating(emptyCardState(NOW), Rating.Good, NOW).fsrs, due: "not a date" };
    expect(isDue(makeCard({ fsrs }), NOW)).toBe(true);
    expect(buildQueue([makeCard({ fsrs })], NOW)).toHaveLength(1);
  });
});

describe("isNew", () => {
  it("new card is New; reviewed card is not", () => {
    expect(isNew(makeCard())).toBe(true);
    const { fsrs } = applyRating(emptyCardState(NOW), Rating.Good, NOW);
    expect(isNew(makeCard({ fsrs }))).toBe(false);
  });
});

describe("countsByDeck / totalCounts", () => {
  it("counts due reviews separately from unseen words", () => {
    const due = { ...applyRating(emptyCardState(NOW), Rating.Good, NOW).fsrs, due: NOW.toISOString() };
    expect(totalCounts([makeCard({ id: "r", fsrs: due }), makeCard({ id: "n" })], NOW)).toEqual({ total: 2, due: 1, newCards: 1 });
  });

  it("groups totals, due, and new per deck", () => {
    const reviewed = applyRating(emptyCardState(NOW), Rating.Easy, NOW).fsrs;
    const cards = [
      makeCard({ id: "a", deckId: "d1" }),
      makeCard({ id: "b", deckId: "d1", fsrs: reviewed }),
      makeCard({ id: "c", deckId: "d2" }),
    ];
    const byDeck = countsByDeck(cards, NOW);
    expect(byDeck.get("d1")).toEqual({ total: 2, due: 0, newCards: 1 });
    expect(byDeck.get("d2")).toEqual({ total: 1, due: 0, newCards: 1 });
    expect(totalCounts(cards, NOW)).toEqual({ total: 3, due: 0, newCards: 2 });
  });
});

describe("new word allowance", () => {
  it("introduces unseen words oldest first and never beyond the allowance", () => {
    const cards = Array.from({ length: 20 }, (_, i) => makeCard({
      id: `n${String(i).padStart(2, "0")}`,
      createdAt: new Date(NOW.getTime() - (20 - i) * 1000).toISOString(),
    }));
    const queue = buildQueue(cards, NOW, { random: () => 0, newLimit: 5 });
    expect(queue.map((card) => card.id).sort()).toEqual(["n00", "n01", "n02", "n03", "n04"]);
    expect(buildQueue(cards, NOW, { newLimit: 0 })).toEqual([]);
  });

  it("still fills the batch with reviews when no new words are allowed", () => {
    const review = (id: string) => makeCard({ id, fsrs: { ...applyRating(emptyCardState(NOW), Rating.Good, NOW).fsrs, due: NOW.toISOString() } });
    const cards = [review("r1"), review("r2"), makeCard({ id: "new" })];
    expect(buildQueue(cards, NOW, { newLimit: 0 }).map((card) => card.id).sort()).toEqual(["r1", "r2"]);
  });
});

describe("learning-first order", () => {
  it("puts a card returning from a learning step ahead of overdue reviews", () => {
    const learning = applyRating(emptyCardState(NOW), Rating.Good, new Date(NOW.getTime() - 3_600_000), "write").fsrs;
    const overdue = { ...applyRating(emptyCardState(NOW), Rating.Easy, NOW).fsrs, due: new Date(NOW.getTime() - 30 * 86_400_000).toISOString() };
    const cards = [makeCard({ id: "old", fsrs: overdue }), makeCard({ id: "step", fsrs: learning })];
    expect(buildQueue(cards, NOW, { limit: 1 }).map((card) => card.id)).toEqual(["step"]);
  });

  it("shows cards returning from a learning step first in the batch", () => {
    const learning = applyRating(emptyCardState(NOW), Rating.Good, new Date(NOW.getTime() - 3_600_000), "write").fsrs;
    const cards = [...Array.from({ length: 10 }, (_, i) => makeCard({ id: `n${i}` })), makeCard({ id: "step", fsrs: learning })];
    for (const seed of [0, 0.5, 0.99]) expect(buildQueue(cards, NOW, { random: () => seed })[0].id).toBe("step");
  });
});

describe("buildQueue", () => {
  it("includes only due cards, shuffled deterministically", () => {
    const future = applyRating(emptyCardState(NOW), Rating.Easy, NOW).fsrs;
    const cards = [
      makeCard({ id: "a" }),
      makeCard({ id: "b", fsrs: future }),
      makeCard({ id: "c" }),
    ];
    const queue = buildQueue(cards, NOW, { random: () => 0 });
    expect(queue.map((c) => c.id).sort()).toEqual(["a", "c"]);
  });

  it("caps a session at the limit", () => {
    const cards = Array.from({ length: 40 }, (_, i) => makeCard({ id: `c${i}` }));
    expect(buildQueue(cards, NOW, { random: () => 0 })).toHaveLength(25);
    expect(buildQueue(cards, NOW, { random: () => 0, limit: 10 })).toHaveLength(10);
  });

  it("selects the most overdue cards first when capping", () => {
    const overdue = (hoursAgo: number) => {
      const fsrs = emptyCardState(NOW);
      fsrs.due = new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString();
      return fsrs;
    };
    const cards = [
      makeCard({ id: "recent", fsrs: overdue(1) }),
      makeCard({ id: "oldest", fsrs: overdue(48) }),
      makeCard({ id: "older", fsrs: overdue(24) }),
    ];
    const queue = buildQueue(cards, NOW, { random: () => 0, limit: 2 });
    expect(queue.map((c) => c.id).sort()).toEqual(["older", "oldest"]);
  });
});
