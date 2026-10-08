import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyCardState } from "@/lib/fsrs";
import { GET } from "@/app/api/review/queue/route";

const session = { userId: "user-1", role: "user" as const, isAdmin: false };
const mocks = vi.hoisted(() => ({ requireRegularUser: vi.fn(), getDeck: vi.fn(), listCards: vi.fn(), listAllCards: vi.fn(), listDecks: vi.fn() }));
vi.mock("@/lib/api", () => ({
  requireRegularUser: mocks.requireRegularUser,
  badRequest: (error: string) => Response.json({ error }, { status: 400 }),
  notFound: (error: string) => Response.json({ error }, { status: 404 }),
}));
vi.mock("@/lib/db", () => mocks);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRegularUser.mockResolvedValue({ session, response: null });
  mocks.getDeck.mockResolvedValue({ id: "deck", name: "Chinese" });
  mocks.listDecks.mockResolvedValue([{ id: "deck", name: "Chinese" }]);
  const now = new Date("2026-01-01T00:00:00.000Z");
  mocks.listCards.mockResolvedValue([
    { id: "a", deckId: "deck", front: "hello", back: "你好", fsrs: emptyCardState(now), createdAt: now.toISOString(), updatedAt: now.toISOString() },
    { id: "b", deckId: "deck", front: "hello", back: "world", fsrs: emptyCardState(now), createdAt: now.toISOString(), updatedAt: now.toISOString() },
  ]);
});

describe("Pinyin queue API", () => {
  it("authenticates before reading cards", async () => {
    mocks.requireRegularUser.mockResolvedValue({
      session: null,
      response: Response.json({ error: "unauthorized" }, { status: 401 }),
    });
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
    expect(mocks.listCards).toHaveBeenCalledWith("deck", { consistent: true, session });
  });

  it("serves every mode across all decks and rejects unknown modes", async () => {
    mocks.listAllCards.mockResolvedValue(await mocks.listCards());
    for (const mode of ["review", "write", "pinyin"]) {
      const res = await GET(new Request(`https://example.com/api/review/queue?deckId=all&mode=${mode}`));
      expect(res.status).toBe(200);
      expect((await res.json()).totalDue).toBe(mode === "review" ? 2 : 1);
    }
    expect((await GET(new Request("https://example.com/api/review/queue?deckId=deck&mode=unknown"))).status).toBe(400);
  });

  it("returns 404 for a deleted deck", async () => {
    mocks.getDeck.mockResolvedValue(null);
    expect((await GET(new Request("https://example.com/api/review/queue?deckId=deck&mode=pinyin"))).status).toBe(404);
  });

  it("adds Chinese readings to the ordinary review queue", async () => {
    const res = await GET(new Request("https://example.com/api/review/queue?deckId=deck"));
    const data = await res.json();
    expect(data.totalDue).toBe(2);
    expect(data.queue.find((item: { card: { id: string } }) => item.card.id === "a").pinyin).toMatchObject({
      hanzi: "你好", meaning: "hello", syllables: ["nǐ", "hǎo"],
    });
    expect(data.queue.find((item: { card: { id: string } }) => item.card.id === "b").pinyin).toBeUndefined();
  });
});

it("lets a deck start unseen words directly without reviving unreviewed copies of known words", async () => {
  const { applyRating, Rating } = await import("@/lib/fsrs");
  const cards = await mocks.listCards();
  const known = { ...cards[0], id: "known", fsrs: applyRating(cards[0].fsrs, Rating.Good, new Date()).fsrs };
  mocks.listCards.mockResolvedValue([known, cards[0], cards[1]]);
  const res = await GET(new Request("https://example.com/api/review/queue?deckId=deck&new=1"));
  const data = await res.json();
  expect(data.totalDue).toBe(1);
  expect(data.queue[0].card.id).toBe("b");
  expect(res.headers.get("cache-control")).toContain("no-store");
});

it("serves independent queues after successful recognition and writing reviews", async () => {
  const { rateMode } = await import("@/lib/modes");
  const [initial] = await mocks.listCards();
  let card = rateMode(initial, "review", 3, new Date()).card;
  mocks.listCards.mockImplementation(async () => [card]);
  const queue = async (mode: string) => (await GET(new Request(`https://example.com/api/review/queue?deckId=deck&mode=${mode}`))).json();
  expect((await queue("review")).totalDue).toBe(0);
  expect((await queue("write")).totalDue).toBe(1);
  expect((await queue("pinyin")).totalDue).toBe(1);
  card = rateMode(card, "write", 3, new Date()).card;
  expect((await queue("write")).totalDue).toBe(0);
  expect((await queue("pinyin")).totalDue).toBe(1);
  expect(card.fsrs.reps).toBe(1);
});
it("serves marked words through every special-deck queue with original card IDs", async () => {
  const cards = await mocks.listCards();
  mocks.listAllCards.mockResolvedValue([{ ...cards[0], hard: true }, cards[1]]);
  for (const mode of ["review", "write", "pinyin"]) {
    const res = await GET(new Request(`https://example.com/api/review/queue?deckId=hard-words&mode=${mode}`));
    const data = await res.json();
    expect(data.queue).toHaveLength(1);
    expect(data.queue[0].card).toMatchObject({ id: "a", deckId: "deck", hard: true });
  }
});

it("includes tone-marked pinyin beside the meaning for Chinese writing", async () => {
  const cards = await mocks.listCards();
  mocks.listCards.mockResolvedValue([{ ...cards[0], front: "line", back: "行 (háng)" }]);
  const response = await GET(new Request("https://example.com/api/review/queue?deckId=deck&mode=write"));
  const data = await response.json();
  expect(data.queue).toHaveLength(1);
  expect(data.queue[0].pinyin).toMatchObject({ hanzi: "行", meaning: "line", syllables: ["háng"] });
  expect(data.queue[0].card.fsrs.reps).toBe(0);
});

it("uses each card's own deck settings in the global writing queue", async () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const base = { fsrs: emptyCardState(now), createdAt: now.toISOString(), updatedAt: now.toISOString() };
  mocks.listDecks.mockResolvedValue([
    { id: "front-deck", name: "A", chineseSide: "front" },
    { id: "back-deck", name: "B", chineseSide: "back" },
  ]);
  mocks.listAllCards.mockResolvedValue([
    { ...base, id: "a", deckId: "front-deck", front: "你好", back: "您好" },
    { ...base, id: "b", deckId: "back-deck", front: "你好", back: "您好" },
  ]);
  const data = await (await GET(new Request("https://example.com/api/review/queue?deckId=all&mode=write"))).json();
  const sides = Object.fromEntries(data.queue.map((item: { card: { id: string }; chineseSide: string }) => [item.card.id, item.chineseSide]));
  expect(sides).toEqual({ a: "front", b: "back" });
});

it("limits regular sessions to a day's new words while Learn new words stays open", async () => {
  const now = new Date();
  const fresh = Array.from({ length: 30 }, (_, i) => ({
    id: `n${i}`, deckId: "deck", front: `word ${i}`, back: `meaning ${i}`,
    fsrs: emptyCardState(now), createdAt: now.toISOString(), updatedAt: now.toISOString(),
  }));
  const { rateMode } = await import("@/lib/modes");
  const introduced = fresh.slice(0, 4).map((card) => rateMode(card, "review", 3, now).card);
  mocks.listCards.mockResolvedValue([...introduced, ...fresh.slice(4)]);
  const regular = await (await GET(new Request("https://example.com/api/review/queue?deckId=deck"))).json();
  expect(regular.totalDue).toBe(7);
  expect(regular.queue).toHaveLength(7);
  const learn = await (await GET(new Request("https://example.com/api/review/queue?deckId=deck&new=1"))).json();
  expect(learn.totalDue).toBe(26);
  expect(learn.queue).toHaveLength(25);
});

it("honors Learn new words in writing modes", async () => {
  const { rateMode } = await import("@/lib/modes");
  const [chinese] = await mocks.listCards();
  const second = { ...chinese, id: "c", front: "goodbye", back: "再见" };
  const written = rateMode(chinese, "write", 1, new Date(Date.now() - 120_000)).card;
  mocks.listCards.mockResolvedValue([written, second]);
  const data = await (await GET(new Request("https://example.com/api/review/queue?deckId=deck&mode=write&new=1"))).json();
  expect(data.queue.map((item: { card: { id: string } }) => item.card.id)).toEqual(["c"]);
});
