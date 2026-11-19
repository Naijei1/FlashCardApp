// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { emptyCardState } from "@/lib/fsrs";
import { beforeEach, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  listDecks: vi.fn(),
  listAllCards: vi.fn(),
  nextReleaseTeaser: vi.fn(),
  countReviewLogs: vi.fn(),
}));

vi.mock("@/lib/db", () => db);
vi.mock("@/lib/practice-group-store", () => ({ listPracticeGroups: vi.fn(async () => []) }));
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
  default: ({ href, children }: { href: string; children?: ReactNode }) => createElement("a", { href }, children),
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


it.each([false, true])("renders a single Weak words card (starred: %s)", async (hard) => {
  const now = new Date();
  if (hard) db.listAllCards.mockResolvedValue([{
    id: "word", deckId: "deck", front: "你好", back: "hello", hard,
    createdAt: now.toISOString(), updatedAt: now.toISOString(), fsrs: emptyCardState(now),
  }]);
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(await HomePage({ searchParams: Promise.resolve({}) }));
  const [section] = container.querySelectorAll('section[aria-label="Weak words"]');
  const links = [...section.querySelectorAll("a")];
  expect(links.map((link) => link.getAttribute("href"))).toEqual(hard ? ["/clinic", "/decks/hard-words"] : ["/clinic"]);
  expect(links[0].textContent).toContain(hard ? "1 weak word to drill" : "Misses and starred words show up here");
  if (hard) {
    expect(links[1].textContent).toBe("★ 1 starred");
    expect(links[1].parentElement).toBe(links[0].parentElement);
  }
  expect(container.querySelectorAll('a[href="/decks/all"]')).toHaveLength(1);
  expect(container.querySelector('a[href="/import"]')?.textContent).toBe("Import CSV");
});
