import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ requireAuth: vi.fn(), listAllCards: vi.fn() }));
vi.mock("@/lib/api", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("@/lib/db", () => ({ listAllCards: mocks.listAllCards }));
import { GET } from "@/app/api/progress/route";
beforeEach(() => { vi.clearAllMocks(); mocks.requireAuth.mockResolvedValue(null); mocks.listAllCards.mockResolvedValue([]); });
it("does not read vocabulary for an unauthenticated request", async () => {
  mocks.requireAuth.mockResolvedValue(Response.json({ error: "unauthorized" }, { status: 401 }));
  expect((await GET()).status).toBe(401);
  expect(mocks.listAllCards).not.toHaveBeenCalled();
});
it("reads fresh progress and prevents cached responses", async () => {
  const res = await GET();
  expect(res.headers.get("cache-control")).toContain("no-store");
  expect(await res.json()).toEqual({ today: 0, week: 0 });
  expect(mocks.listAllCards).toHaveBeenCalledWith(undefined, { consistent: true });
});
