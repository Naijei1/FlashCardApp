import { beforeEach, it, expect, vi } from "vitest";
import { emptyCardState } from "@/lib/fsrs";
const session = { userId: "user-1", role: "user" as const, isAdmin: false };
const db = vi.hoisted(() => ({ getCard: vi.fn(), listCards: vi.fn(), listAllCards: vi.fn(), listDecks: vi.fn(async () => [{ id: "lesson", name: "Lesson" }]), getDeck: vi.fn(), setCardHard: vi.fn() }));
const auth = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => db);
vi.mock("@/lib/api", () => ({ requireRegularUser: auth, badRequest: (error: string) => Response.json({ error }, { status: 400 }), notFound: (error: string) => Response.json({ error }, { status: 404 }) }));
import { hardWords, loadStudySet } from "@/lib/study-sets";
import { PATCH } from "@/app/api/cards/[id]/hard/route";
const now = new Date();
const card = { id: "a", deckId: "lesson", front: "你好", back: "hello", fsrs: emptyCardState(now), createdAt: now.toISOString(), updatedAt: now.toISOString() };
const copies = [card, { ...card, id: "b", front: card.back, back: card.front }];
const request = (body: unknown) => new Request("https://example.com/api/cards/a/hard", { method: "PATCH", body: JSON.stringify(body) });
const params = { params: Promise.resolve({ id: "a" }) };
beforeEach(() => { vi.clearAllMocks(); auth.mockResolvedValue({ session, response: null }); db.getCard.mockResolvedValue(card); db.listCards.mockResolvedValue(copies); db.setCardHard.mockResolvedValue(undefined); });
it.each([true, false])("sets hard=%s on all reverse copies without moving or rescheduling cards", async (hard) => {
  const response = await PATCH(request({ deckId: "lesson", hard }), params);
  expect(response.status).toBe(200);
  expect(db.setCardHard.mock.calls).toEqual([["lesson", "a", hard, session], ["lesson", "b", hard, session]]);
});
it("requires authentication and validates the marker", async () => {
  auth.mockResolvedValueOnce({ session: null, response: Response.json({}, { status: 401 }) });
  expect((await PATCH(request({ deckId: "lesson", hard: true }), params)).status).toBe(401);
  expect(db.getCard).not.toHaveBeenCalled();
  expect((await PATCH(request({ deckId: "lesson", hard: "yes" }), params)).status).toBe(400);
});
it("returns not found for deleted cards", async () => {
  db.getCard.mockResolvedValue(null);
  expect((await PATCH(request({ deckId: "lesson", hard: true }), params)).status).toBe(404);
  expect(db.setCardHard).not.toHaveBeenCalled();
});
it("includes latest siblings for deduplication but excludes unmarked words", async () => {
  const source = [{ ...card, hard: true }, copies[1], { ...card, id: "c", front: "老师" }];
  db.listAllCards.mockResolvedValue(source);
  const result = (await loadStudySet("hard-words"))!.cards;
  expect(result).toHaveLength(2);
  expect(result.every((c) => c.deckId === "lesson" && c.hard)).toBe(true);
  expect(hardWords(copies)).toEqual([]);
});
