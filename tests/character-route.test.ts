import { beforeEach, expect, it, vi } from "vitest";

const lookup = vi.hoisted(() => ({ lookupCharacter: vi.fn(), requireAuth: vi.fn() }));

vi.mock("@/lib/character-lookup", () => ({ lookupCharacter: lookup.lookupCharacter }));
vi.mock("@/lib/api", () => ({
  requireAuth: lookup.requireAuth,
  badRequest: (message: string) => Response.json({ error: message }, { status: 400 }),
  accessErrorResponse: () => null,
}));

import { GET } from "@/app/api/characters/route";

beforeEach(() => {
  lookup.lookupCharacter.mockReset();
  lookup.requireAuth.mockReset();
  lookup.requireAuth.mockResolvedValue(null);
});

it("requires a single Chinese character and passes the current card through", async () => {
  const missing = await GET(new Request("https://flashcards.example/api/characters?c=ab"));
  expect(missing.status).toBe(400);
  expect(lookup.lookupCharacter).not.toHaveBeenCalled();

  lookup.lookupCharacter.mockResolvedValue({
    character: "学",
    words: [{ deckId: "deck", cardId: "other", hanzi: "学生", meaning: "student" }],
    total: 1,
    truncated: false,
  });
  const response = await GET(
    new Request("https://flashcards.example/api/characters?c=%E5%AD%A6&deckId=deck&cardId=card")
  );
  expect(response.status).toBe(200);
  expect(lookup.lookupCharacter).toHaveBeenCalledWith("学", { deckId: "deck", cardId: "card" });
  await expect(response.json()).resolves.toMatchObject({ character: "学", total: 1 });
});

it("rejects a signed-out lookup", async () => {
  lookup.requireAuth.mockResolvedValue(Response.json({ error: "unauthorized" }, { status: 401 }));
  const response = await GET(new Request("https://flashcards.example/api/characters?c=%E5%AD%A6"));
  expect(response.status).toBe(401);
  expect(lookup.lookupCharacter).not.toHaveBeenCalled();
});
