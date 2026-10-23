import { beforeEach, expect, it, vi } from "vitest";
import { emptyCardState } from "@/lib/fsrs";
import { effectiveCard, progressKey, toAdminUserSummary } from "@/lib/multi-user-model";
import type { PendingReviewWrite } from "@/lib/db";

const content = {
  deckId: "deck-1",
  cardId: "card-1",
  front: "你",
  back: "you",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  source: "global" as const,
};

it("keeps each learner's schedule on their own progress key", () => {
  const userA = progressKey("user-a", "global", "deck-1", "card-1");
  const userB = progressKey("user-b", "global", "deck-1", "card-1");
  expect(userA.PK).toBe("USER#user-a");
  expect(userB.PK).toBe("USER#user-b");
  expect(userA.PK).not.toBe(userB.PK);
  expect(userA.SK).toBe("PROGRESS#GLOBAL#deck-1#CARD#card-1");
  expect(userB.SK).toBe(userA.SK);
  const fsrsA = { ...emptyCardState(new Date(content.createdAt)), reps: 4, stability: 9 };
  const cardA = effectiveCard({ content, progress: { fsrs: fsrsA }, hidden: false, released: true, hideProgress: false });
  const cardB = effectiveCard({ content, progress: null, hidden: false, released: true, hideProgress: false });
  expect(cardA?.fsrs.reps).toBe(4);
  expect(cardB?.fsrs.reps).toBe(0);
  expect(cardA?.front).toBe(cardB?.front);
});

it("treats a missing progress item as a new card and hiding as invisible", () => {
  expect(
    effectiveCard({ content, progress: null, hidden: false, released: true, hideProgress: false })?.fsrs.reps
  ).toBe(0);
  expect(effectiveCard({ content, progress: { hard: true }, hidden: true, released: true, hideProgress: false })).toBeNull();
});

it("does not apply learner progress when an admin previews content", () => {
  const card = effectiveCard({
    content,
    progress: { fsrs: { ...emptyCardState(new Date()), reps: 8 }, hard: true },
    hidden: false,
    released: true,
    hideProgress: true,
  });
  expect(card?.fsrs.reps).toBe(0);
  expect(card?.hard).toBeUndefined();
  const summary = toAdminUserSummary({
    userId: "user-a",
    email: "a@example.com",
    role: "user",
    cardsStudied: 3,
    reviewCount: 10,
    currentStreak: 2,
    fsrs: { reps: 8 },
    front: "你",
    cardId: "card-1",
  });
  expect(summary).toEqual({
    userId: "user-a",
    email: "a@example.com",
    role: "user",
    cardsStudied: 3,
    reviewCount: 10,
    currentStreak: 2,
  });
  expect(JSON.stringify(summary)).not.toContain("你");
  expect(JSON.stringify(summary)).not.toContain("card-1");
});

const mocks = vi.hoisted(() => ({ send: vi.fn(), session: vi.fn() }));
vi.mock("@/lib/dynamo", () => ({ doc: { send: mocks.send }, tableName: () => "test-table" }));
vi.mock("@/lib/app-session", () => ({ getAppSession: mocks.session }));

beforeEach(() => {
  vi.clearAllMocks();
});

it("writes progress under the signed-in user and refuses the admin", async () => {
  const { commitReviewForCurrentUser } = await import("@/lib/multi-user-store");
  mocks.session.mockResolvedValue({
    userId: "admin-1",
    email: "admin@example.com",
    role: "admin",
    emailVerified: true,
    authMode: "google",
  });
  await expect(commitReviewForCurrentUser({} as PendingReviewWrite)).rejects.toThrow(/cannot study/);
  expect(mocks.send).not.toHaveBeenCalled();

  const review = {
    clientReviewId: "review_id_123456",
    cardId: "card-1",
    deckId: "deck-1",
    rating: 3,
    reviewedAt: "2026-09-03T14:00:00.000Z",
    mode: "review" as const,
    expectedVersion: null,
    card: {
      ...content,
      id: "card-1",
      fsrs: emptyCardState(new Date(content.createdAt)),
      updatedAt: "2026-09-03T14:00:00.000Z",
    },
    log: {
      review: new Date("2026-09-03T14:00:00.000Z"),
      due: new Date("2026-09-04T14:00:00.000Z"),
      rating: 3,
      state: 0,
      stability: 1,
      difficulty: 5,
      elapsed_days: 0,
      scheduled_days: 1,
    },
  } as unknown as PendingReviewWrite;

  for (const userId of ["user-a", "user-b"]) {
    const writes: Array<Record<string, unknown>> = [];
    mocks.session.mockResolvedValue({
      userId,
      email: `${userId}@example.com`,
      role: "user",
      emailVerified: true,
      authMode: "google",
    });
    mocks.send.mockImplementation(async (command: { input: Record<string, unknown> }) => {
      const key = command.input.Key as { PK?: string } | undefined;
      if (key?.PK === "GLOBAL#DECKS") {
        return {
          Item: {
            PK: "GLOBAL#DECKS",
            SK: "DECK#deck-1",
            name: "Lesson",
            source: "global",
            status: "published",
            createdAt: content.createdAt,
            updatedAt: content.updatedAt,
          },
        };
      }
      if (command.input.TransactItems) {
        writes.push(command.input);
        return {};
      }
      return {};
    });
    expect(await commitReviewForCurrentUser(review)).toEqual({ status: "committed" });
    const items = JSON.stringify(writes);
    expect(items).toContain(`"PK":"USER#${userId}"`);
    expect(items).toContain("PROGRESS#GLOBAL#deck-1#CARD#card-1");
    expect(items).not.toContain(`USER#${userId === "user-a" ? "user-b" : "user-a"}`);
  }
});
