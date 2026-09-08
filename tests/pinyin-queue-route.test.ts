import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyCardState } from "@/lib/fsrs";
import { GET } from "@/app/api/review/queue/route";

const mocks = vi.hoisted(() => ({ requireAuth: vi.fn(), getDeck: vi.fn(), listCards: vi.fn(), listAllCards: vi.fn() }));
vi.mock("@/lib/api", () => ({
  requireAuth: mocks.requireAuth,
  badRequest: (error: string) => Response.json({ error }, { status: 400 }),
  notFound: (error: string) => Response.json({ error }, { status: 404 }),
}));
vi.mock("@/lib/db", () => mocks);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockResolvedValue(null);
  mocks.getDeck.mockResolvedValue({ id: "deck", name: "Chinese" });
  const now = new Date("2026-01-01T00:00:00.000Z");
  mocks.listCards.mockResolvedValue([
    { id: "a", deckId: "deck", front: "hello", back: "你好", fsrs: emptyCardState(now), createdAt: now.toISOString(), updatedAt: now.toISOString() },
    { id: "b", deckId: "deck", front: "hello", back: "world", fsrs: emptyCardState(now), createdAt: now.toISOString(), updatedAt: now.toISOString() },
  ]);
});

describe("Pinyin queue API", () => {
  it("authenticates before reading cards", async () => {
    mocks.requireAuth.mockResolvedValue(Response.json({ error: "unauthorized" }, { status: 401 }));
    expect((await GET(new Request("https://example.com/api/review/queue?deckId=deck&mode=pinyin"))).status).toBe(401);
    expect(mocks.listCards).not.toHaveBeenCalled();
  });

  it("returns generated readings and excludes non-Chinese cards", async () => {
    const res = await GET(new Request("https://example.com/api/review/queue?deckId=deck&mode=pinyin"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.totalDue).toBe(1);
    expect(data.queue).toHaveLength(1);
    expect(data.queue[0].pinyin).toEqual({ hanzi: "你好", meaning: "hello", syllables: ["nǐ", "hǎo"] });
    expect(mocks.listCards).toHaveBeenCalledWith("deck", { consistent: true });
  });

  it("rejects an all-deck request and unknown modes", async () => {
    expect((await GET(new Request("https://example.com/api/review/queue?mode=pinyin"))).status).toBe(400);
    expect((await GET(new Request("https://example.com/api/review/queue?deckId=deck&mode=unknown"))).status).toBe(400);
  });

  it("returns 404 for a deleted deck", async () => {
    mocks.getDeck.mockResolvedValue(null);
    expect((await GET(new Request("https://example.com/api/review/queue?deckId=deck&mode=pinyin"))).status).toBe(404);
  });

  it("keeps the ordinary review queue unchanged", async () => {
    const res = await GET(new Request("https://example.com/api/review/queue?deckId=deck"));
    const data = await res.json();
    expect(data.totalDue).toBe(2);
    expect(data.queue.every((item: object) => !("pinyin" in item))).toBe(true);
  });
});
