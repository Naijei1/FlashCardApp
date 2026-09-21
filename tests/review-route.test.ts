import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyCardState } from "@/lib/fsrs";
import type { Card } from "@/lib/types";

const dbMocks = vi.hoisted(() => ({
  commitReview: vi.fn(),
  getDeck: vi.fn(),
  getCardForReview: vi.fn(),
  getReviewReceipt: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  ...dbMocks,
  reviewReceiptsMatch: (
    left: Record<string, unknown>,
    right: Record<string, unknown>
  ) =>
    left.clientReviewId === right.clientReviewId &&
    left.cardId === right.cardId &&
    left.deckId === right.deckId &&
    left.rating === right.rating &&
    left.reviewedAt === right.reviewedAt,
}));

vi.mock("@/lib/api", () => ({
  requireAuth: vi.fn().mockResolvedValue(null),
  badRequest: (message: string) =>
    Response.json({ error: message }, { status: 400 }),
  notFound: (message: string) =>
    Response.json({ error: message }, { status: 404 }),
}));

import { POST } from "@/app/api/review/route";

const REVIEWED_AT = "2026-09-03T14:00:00.000Z";
const CLIENT_REVIEW_ID = "review_id_123456";

function request(overrides: Record<string, unknown> = {}): Request {
  return new Request("http://localhost/api/review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      cardId: "card-1",
      deckId: "deck-1",
      rating: 3,
      clientReviewId: CLIENT_REVIEW_ID,
      reviewedAt: REVIEWED_AT,
      ...overrides,
    }),
  });
}

function card(): Card {
  const createdAt = "2026-09-01T12:00:00.000Z";
  return {
    id: "card-1",
    deckId: "deck-1",
    front: "front",
    back: "back",
    createdAt,
    updatedAt: createdAt,
    fsrs: emptyCardState(new Date(createdAt)),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.getReviewReceipt.mockResolvedValue(null);
  dbMocks.getDeck.mockResolvedValue({ id: "deck-1" });
});

describe("POST /api/review", () => {
  it("requires a client id and durable review timestamp", async () => {
    const response = await POST(request({ clientReviewId: "", reviewedAt: "" }));

    expect(response.status).toBe(400);
    expect(dbMocks.getReviewReceipt).not.toHaveBeenCalled();
  });

  it("turns a committed-but-lost-response retry into a lean success", async () => {
    dbMocks.getReviewReceipt.mockResolvedValue({
      clientReviewId: CLIENT_REVIEW_ID,
      cardId: "card-1",
      deckId: "deck-1",
      rating: 3,
      reviewedAt: REVIEWED_AT,
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, duplicate: true });
    expect(dbMocks.getCardForReview).not.toHaveBeenCalled();
    expect(dbMocks.commitReview).not.toHaveBeenCalled();
  });

  it("rejects reuse of an id for different review data", async () => {
    dbMocks.getReviewReceipt.mockResolvedValue({
      clientReviewId: CLIENT_REVIEW_ID,
      cardId: "another-card",
      deckId: "deck-1",
      rating: 3,
      reviewedAt: REVIEWED_AT,
    });

    const response = await POST(request());

    expect(response.status).toBe(409);
  });

  it("re-reads and recomputes after an optimistic version conflict", async () => {
    dbMocks.getCardForReview
      .mockResolvedValueOnce({ card: card(), version: null })
      .mockResolvedValueOnce({ card: card(), version: 1 });
    dbMocks.commitReview
      .mockResolvedValueOnce({ status: "conflict" })
      .mockResolvedValueOnce({ status: "committed" });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(dbMocks.getCardForReview).toHaveBeenCalledTimes(2);
    expect(dbMocks.commitReview).toHaveBeenCalledTimes(2);
    expect(dbMocks.commitReview.mock.calls[0][0].expectedVersion).toBeNull();
    expect(dbMocks.commitReview.mock.calls[1][0].expectedVersion).toBe(1);
  });
});

it("persists failure history with the scheduled card in the atomic review write", async () => {
  const existing = card();
  existing.practice = { failures: 4, successes: 8, correctStreak: 2, firstStudiedAt: existing.createdAt };
  dbMocks.getCardForReview.mockResolvedValue({ card: existing, version: 3 });
  dbMocks.commitReview.mockResolvedValue({ status: "committed" });
  const response = await POST(request({ rating: 1 }));
  expect(response.status).toBe(200);
  expect(dbMocks.commitReview.mock.calls[0][0].card.practice).toEqual({
    failures: 5, successes: 8, correctStreak: 0, firstStudiedAt: existing.createdAt,
  });
});
