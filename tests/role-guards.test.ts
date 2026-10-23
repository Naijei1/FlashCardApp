import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  getCardForReview: vi.fn(),
  getReviewReceipt: vi.fn(),
  commitReview: vi.fn(),
  getDeck: vi.fn(),
  listAllCards: vi.fn(),
  queryAll: vi.fn(),
  send: vi.fn(),
}));

vi.mock("@/lib/app-session", () => ({ getAppSession: mocks.session }));
vi.mock("@/lib/dynamo", () => ({
  doc: { send: mocks.send },
  getDocClient: () => ({ send: mocks.send }),
  tableName: () => "test-table",
}));
vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...actual,
    getCardForReview: mocks.getCardForReview,
    getReviewReceipt: mocks.getReviewReceipt,
    commitReview: mocks.commitReview,
    getDeck: mocks.getDeck,
    listAllCards: mocks.listAllCards,
  };
});

import { GET as progressGET } from "@/app/api/progress/route";
import { POST as reviewPOST } from "@/app/api/review/route";
import { GET as adminUsersGET } from "@/app/api/admin/users/route";
import { GET as adminCardsGET } from "@/app/api/admin/users/[id]/cards/route";
import { requireAdmin, requireRegularUser } from "@/lib/api";

const admin = {
  userId: "admin-1",
  email: "admin@example.com",
  role: "admin" as const,
  emailVerified: true,
  authMode: "google" as const,
};
const learner = {
  userId: "user-a",
  email: "learner@example.com",
  role: "user" as const,
  emailVerified: true,
  authMode: "google" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.DATA_MODE;
});
afterEach(() => {
  delete process.env.DATA_MODE;
});

function reviewRequest() {
  return new Request("http://localhost/api/review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      cardId: "card-1",
      deckId: "deck-1",
      rating: 3,
      clientReviewId: "review_id_123456",
      reviewedAt: "2026-10-23T14:00:00.000Z",
    }),
  });
}

it("blocks admin study calls before any card read", async () => {
  mocks.session.mockResolvedValue(admin);
  expect((await requireRegularUser())?.status).toBe(403);
  expect((await reviewPOST(reviewRequest())).status).toBe(403);
  expect((await progressGET()).status).toBe(403);
  expect(mocks.getCardForReview).not.toHaveBeenCalled();
  expect(mocks.listAllCards).not.toHaveBeenCalled();
  expect(mocks.commitReview).not.toHaveBeenCalled();
});

it("lets a learner reach study reads and keeps admin routes closed", async () => {
  mocks.session.mockResolvedValue(learner);
  mocks.getCardForReview.mockResolvedValue(null);
  mocks.getReviewReceipt.mockResolvedValue(null);
  expect(await requireRegularUser()).toBeNull();
  expect((await requireAdmin())?.status).toBe(403);
  expect((await reviewPOST(reviewRequest())).status).toBe(404);
  expect(mocks.getCardForReview).toHaveBeenCalledWith("deck-1", "card-1");
  expect((await adminCardsGET()).status).toBe(403);
});

it("returns only overall stats to an admin and never per-card progress", async () => {
  mocks.session.mockResolvedValue(admin);
  process.env.DATA_MODE = "multi-user";
  mocks.send.mockResolvedValue({
    Items: [
      {
        PK: "USERS",
        SK: "USER#user-a",
        userId: "user-a",
        email: "learner@example.com",
        role: "user",
        cardsStudied: 4,
        reviewCount: 9,
        currentStreak: 2,
        front: "你",
        fsrs: { reps: 5 },
        cardId: "card-1",
      },
    ],
  });
  const response = await adminUsersGET();
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body.users).toEqual([
    {
      userId: "user-a",
      email: "learner@example.com",
      role: "user",
      cardsStudied: 4,
      reviewCount: 9,
      currentStreak: 2,
    },
  ]);
  expect(JSON.stringify(body)).not.toContain("你");
  expect(JSON.stringify(body)).not.toContain("card-1");
  const cards = await adminCardsGET();
  expect(cards.status).toBe(403);
  expect(await cards.json()).toEqual({ error: "per-card progress is not available to admin accounts" });
});

it("rejects signed-out callers", async () => {
  mocks.session.mockResolvedValue(null);
  expect((await reviewPOST(reviewRequest())).status).toBe(401);
  expect(mocks.getCardForReview).not.toHaveBeenCalled();
});
