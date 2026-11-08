import { beforeEach, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  listDecks: vi.fn(),
  listAllCards: vi.fn(),
  nextReleaseTeaser: vi.fn(),
  countReviewLogs: vi.fn(),
}));

vi.mock("@/lib/db", () => db);
vi.mock("@/lib/app-session", () => ({
  getAppSession: vi.fn(async () => ({ role: "user", userId: "user-a" })),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
  notFound: () => {
    throw new Error("not found");
  },
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/",
}));
vi.mock("next/link", () => ({
  default: ({ children }: { children?: unknown }) => children ?? null,
}));

import HomePage from "@/app/(app)/page";
import BrowsePage from "@/app/(app)/browse/page";
import StatsPage from "@/app/(app)/stats/page";

beforeEach(() => {
  vi.clearAllMocks();
  db.listDecks.mockResolvedValue([]);
  db.listAllCards.mockResolvedValue([]);
  db.nextReleaseTeaser.mockResolvedValue(null);
  db.countReviewLogs.mockResolvedValue(0);
});

it("reads home counts from a consistent snapshot", async () => {
  await HomePage({ searchParams: Promise.resolve({}) });
  expect(db.listAllCards).toHaveBeenCalledWith([], { consistent: true });
});

it("reads browse cards from a consistent snapshot", async () => {
  await BrowsePage({ searchParams: Promise.resolve({}) });
  expect(db.listAllCards).toHaveBeenCalledWith([], { consistent: true });
});

it("reads stats from a consistent snapshot", async () => {
  await StatsPage();
  expect(db.listAllCards).toHaveBeenCalledWith([], { consistent: true });
  expect(db.countReviewLogs).toHaveBeenCalled();
});
