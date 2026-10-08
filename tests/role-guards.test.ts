import { beforeEach, describe, expect, it, vi } from "vitest";

const ctx = vi.hoisted(() => ({
  headers: new Headers(),
  cookie: undefined as string | undefined,
  cookies: {} as Record<string, string>,
}));
const db = vi.hoisted(() => ({
  commitReview: vi.fn(),
  getDeck: vi.fn(),
  getCard: vi.fn(),
  getCardForReview: vi.fn(),
  getReviewReceipt: vi.fn(),
  reviewReceiptsMatch: vi.fn(() => false),
  listAllCards: vi.fn(),
  listCards: vi.fn(),
  listDecks: vi.fn(),
  setCardHard: vi.fn(),
  hideGlobalCard: vi.fn(),
  hideGlobalDeck: vi.fn(),
  unhideGlobalCard: vi.fn(),
  unhideGlobalDeck: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      if (name === "session" && ctx.cookie) return { value: ctx.cookie };
      return ctx.cookies[name] ? { value: ctx.cookies[name] } : undefined;
    },
    set: (name: string, value: string) => {
      ctx.cookies[name] = value;
    },
    delete: (name: string) => {
      delete ctx.cookies[name];
    },
  }),
  headers: async () => ctx.headers,
}));
vi.mock("@/lib/db", () => db);

import { GET as cognitoLogin } from "@/app/api/auth/cognito/login/route";
import { PATCH as hard } from "@/app/api/cards/[id]/hard/route";
import { GET as progress } from "@/app/api/progress/route";
import { GET as queue } from "@/app/api/review/queue/route";
import { POST as review } from "@/app/api/review/route";
import { POST as visibility } from "@/app/api/visibility/route";
import { getAuthSession, sessionFromCognitoClaims, signSession } from "@/lib/auth";

function asAdmin() {
  ctx.headers = new Headers({
    "x-flashcards-dev-role": "admin",
    "x-flashcards-dev-user-id": "admin-1",
  });
}

function asUser() {
  ctx.headers = new Headers({
    "x-flashcards-dev-role": "user",
    "x-flashcards-dev-user-id": "user-1",
    "x-flashcards-dev-email": "user@example.com",
  });
}

function reviewRequest(): Request {
  return new Request("http://localhost/api/review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      cardId: "card-1",
      deckId: "deck-1",
      rating: 3,
      clientReviewId: "review_id_123456",
      reviewedAt: "2026-09-03T14:00:00.000Z",
      userId: "attacker",
      role: "admin",
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("AUTH_MODE", "local-dev");
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("SESSION_SECRET", "a".repeat(64));
  ctx.cookie = undefined;
  ctx.cookies = {};
  db.getReviewReceipt.mockResolvedValue(null);
  db.getCardForReview.mockResolvedValue(null);
});

describe("study route guards", () => {
  it("rejects admin study, queue, progress, and hard-marker calls before any read", async () => {
    asAdmin();
    expect((await review(reviewRequest())).status).toBe(403);
    expect((await queue(new Request("http://localhost/api/review/queue?deckId=deck-1"))).status).toBe(403);
    expect((await progress()).status).toBe(403);
    expect((await hard(
      new Request("http://localhost/api/cards/card-1/hard", {
        method: "PATCH",
        body: JSON.stringify({ deckId: "deck-1", hard: true }),
      }),
      { params: Promise.resolve({ id: "card-1" }) }
    )).status).toBe(403);
    expect(db.commitReview).not.toHaveBeenCalled();
    expect(db.getReviewReceipt).not.toHaveBeenCalled();
    expect(db.getCardForReview).not.toHaveBeenCalled();
    expect(db.listCards).not.toHaveBeenCalled();
    expect(db.listAllCards).not.toHaveBeenCalled();
    expect(db.setCardHard).not.toHaveBeenCalled();
  });

  it("ignores userId and role in the body and uses the authenticated user", async () => {
    asUser();
    expect((await review(reviewRequest())).status).toBe(404);
    expect(db.getReviewReceipt).toHaveBeenCalledWith(
      "review_id_123456",
      expect.objectContaining({ userId: "user-1", role: "user", isAdmin: false })
    );
    expect(db.commitReview).not.toHaveBeenCalled();
  });
});

describe("account claims", () => {
  it("maps only the Cognito admins group to the admin role", () => {
    expect(sessionFromCognitoClaims({ sub: "user-1", token_use: "id", email: "a@example.com" })).toMatchObject({
      userId: "user-1",
      role: "user",
      isAdmin: false,
    });
    expect(sessionFromCognitoClaims({
      sub: "admin-1",
      token_use: "id",
      "cognito:groups": ["admins"],
      role: "user",
    })).toMatchObject({ userId: "admin-1", role: "admin", isAdmin: true });
    expect(sessionFromCognitoClaims({ sub: "user-1", token_use: "id", role: "admin" })?.role).toBe("user");
    expect(sessionFromCognitoClaims({ sub: "user-1", token_use: "access", "cognito:groups": ["admins"] })).toBeNull();
    expect(sessionFromCognitoClaims({ token_use: "id" })).toBeNull();
  });

  it("keeps a shared-password session as a regular user", async () => {
    vi.stubEnv("AUTH_MODE", "shared");
    ctx.cookie = await signSession();
    await expect(getAuthSession()).resolves.toMatchObject({
      userId: "legacy-user",
      role: "user",
      isAdmin: false,
    });
  });

  it("refuses local-dev auth in production and hides Cognito login while shared auth is active", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_MODE", "local-dev");
    await expect(getAuthSession()).rejects.toThrow(/production/);
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("AUTH_MODE", "shared");
    expect((await cognitoLogin(new Request("http://localhost/api/auth/cognito/login"))).status).toBe(404);
    expect((await visibility(new Request("http://localhost/api/visibility", { method: "POST", body: "{}" }))).status).toBe(404);
  });
});
