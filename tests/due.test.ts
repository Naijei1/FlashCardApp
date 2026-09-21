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

describe("isNew", () => {
  it("new card is New; reviewed card is not", () => {
    expect(isNew(makeCard())).toBe(true);
    const { fsrs } = applyRating(emptyCardState(NOW), Rating.Good, NOW);
    expect(isNew(makeCard({ fsrs }))).toBe(false);
  });
});

describe("countsByDeck / totalCounts", () => {
  it("groups totals, due, and new per deck", () => {
    const reviewed = applyRating(emptyCardState(NOW), Rating.Easy, NOW).fsrs;
    const cards = [
      makeCard({ id: "a", deckId: "d1" }),
      makeCard({ id: "b", deckId: "d1", fsrs: reviewed }),
      makeCard({ id: "c", deckId: "d2" }),
    ];
    const byDeck = countsByDeck(cards, NOW);
    expect(byDeck.get("d1")).toEqual({ total: 2, due: 1, newCards: 1 });
    expect(byDeck.get("d2")).toEqual({ total: 1, due: 1, newCards: 1 });
    expect(totalCounts(cards, NOW)).toEqual({ total: 3, due: 2, newCards: 2 });
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
    const queue = buildQueue(cards, NOW, () => 0);
    expect(queue.map((c) => c.id).sort()).toEqual(["a", "c"]);
  });

  it("caps a session at the limit", () => {
    const cards = Array.from({ length: 40 }, (_, i) => makeCard({ id: `c${i}` }));
    expect(buildQueue(cards, NOW, () => 0)).toHaveLength(25);
    expect(buildQueue(cards, NOW, () => 0, 10)).toHaveLength(10);
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
    const queue = buildQueue(cards, NOW, () => 0, 2);
    expect(queue.map((c) => c.id).sort()).toEqual(["older", "oldest"]);
  });
});
