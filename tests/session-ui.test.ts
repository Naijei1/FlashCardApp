// @vitest-environment jsdom
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ReviewPage from "@/app/(app)/review/[deckId]/page";
import WritePage from "@/app/(app)/write/[deckId]/page";
import PinyinPage from "@/app/(app)/pinyin/[deckId]/page";
import ReviewSession from "@/components/ReviewSession";
import WriteSession from "@/components/WriteSession";
import { emptyCardState, previewIntervals, Rating } from "@/lib/fsrs";
import { buildReviewQueueData } from "@/lib/review-queue";
import { buildPinyinQueueData } from "@/lib/pinyin-queue";
import { cardForMode, rateMode } from "@/lib/modes";
import { formatInterval } from "@/lib/interval-label";
import type { Card, ReviewMode } from "@/lib/types";

const db = vi.hoisted(() => ({ getDeck: vi.fn(), listDecks: vi.fn(), listCards: vi.fn() }));
vi.mock("@/lib/db", () => db);
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not found"); } }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => createElement("a", { href }, children) }));
vi.mock("@/components/TtsButton", () => ({ default: () => null }));

const now = new Date("2026-09-16T12:00:00Z");
let root: Root;
let container: HTMLDivElement;
let card: Card;
let siblings: Card[];
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  vi.setSystemTime(now);
  localStorage.clear();
  siblings = [];
  card = { id: "card", deckId: "deck", front: "你好", back: "hello", createdAt: now.toISOString(), updatedAt: now.toISOString(), fsrs: emptyCardState(now) };
  const deck = { id: "deck", name: "Chinese", frontLanguage: "zh-CN" };
  db.getDeck.mockResolvedValue(deck);
  db.listDecks.mockResolvedValue([deck]);
  db.listCards.mockImplementation(async () => [card, ...siblings]);
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/hard")) {
      card = { ...card, hard: JSON.parse(init!.body as string).hard };
      return { ok: true, json: async () => ({ ok: true }) };
    }
    if (url === "/api/review") {
      const body = JSON.parse(init!.body as string);
      card = rateMode(card, body.mode ?? "review", body.rating, new Date(body.reviewedAt)).card;
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    const mode = (new URL(url, "https://example.com").searchParams.get("mode") ?? "review") as ReviewMode;
    const cards = [card, ...siblings].map((c) => cardForMode(c, mode));
    const data = mode === "pinyin" ? buildPinyinQueueData(cards, "front", new Date()) : buildReviewQueueData(cards, new Date());
    return { ok: true, json: async () => data };
  });
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function render(element: ReactElement) {
  await act(async () => root.render(element));
}
async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find((item) => item.textContent?.startsWith(label));
  expect(button, label).toBeTruthy();
  await act(async () => button!.click());
}

it.each([["review", ReviewPage], ["write", WritePage], ["pinyin", PinyinPage]] as const)("revalidates a cached %s page after an Easy review", async (mode, page) => {
  const cachedPage = await page({ params: Promise.resolve({ deckId: "deck" }) });
  await render(cachedPage);
  if (page === ReviewPage) await click("Show answer");
  else await click("Don't know");
  await click("Easy");
  expect(cardForMode(card, mode).fsrs.reps).toBe(1);
  await act(async () => root.unmount());
  root = createRoot(container);
  await render(cachedPage);
  expect(container.textContent).toContain("Nothing due");
  expect(container.querySelector("#write-input")).toBeNull();
});

it.each(["review", "write", "pinyin"] as const)("refreshes interval labels after a long pause in %s", async (mode) => {
  card = rateMode(card, mode, Rating.Good, now).card;
  vi.setSystemTime(new Date(cardForMode(card, mode).fsrs.due));
  const element = mode === "review"
    ? createElement(ReviewSession, { deckId: "deck", deckLangs: {}, backHref: "/" })
    : createElement(WriteSession, { deckId: "deck", deckSide: "front", chineseLang: "zh-CN", backHref: "/", mode: mode as "write" | "pinyin" });
  await render(element);
  vi.setSystemTime(new Date(now.getTime() + 3 * 86_400_000));
  await act(async () => window.dispatchEvent(new Event("focus")));
  if (mode === "review") await click("Show answer");
  else await click("Don't know");
  const expected = previewIntervals(cardForMode(card, mode).fsrs, new Date());
  const good = [...container.querySelectorAll("button")].find((button) => button.textContent?.startsWith("Good"));
  expect(good?.querySelector("span")?.textContent).toBe(expected.good);
  const ratedAt = Date.now();
  await click("Good");
  expect(formatInterval(Date.parse(cardForMode(card, mode).fsrs.due) - ratedAt)).toBe(expected.good);
});

async function typeAnswer(value: string) {
  const input = container.querySelector<HTMLInputElement>("#write-input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it.each(["write", "pinyin"] as const)("grades the supplied answer on an annotated new card in %s", async (mode) => {
  card.front = "行 (háng)";
  card.back = "line";
  await render(createElement(WriteSession, { deckId: "deck", deckSide: "front", chineseLang: "zh-CN", backHref: "/", mode }));
  await typeAnswer(mode === "write" ? "行" : "hang2");
  await click("Check answer");
  expect(container.textContent).toContain("Correct");
});

it("parks a Retry card until due and ignores reveal shortcuts during the wait", async () => {
  await render(createElement(ReviewSession, { deckId: "deck", deckLangs: {}, backHref: "/" }));
  await click("Show answer");
  await click("Retry");
  expect(container.textContent).toContain("Next card is still learning");
  await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: " " })));
  await act(async () => vi.advanceTimersByTimeAsync(59_000));
  expect(container.textContent).toContain("Next card is still learning");
  await act(async () => vi.advanceTimersByTimeAsync(1_000));
  expect(container.textContent).toContain("Show answer");
  expect(card.fsrs.reps).toBe(1);
});

it.each(["write", "pinyin"] as const)("requires three correct corrections for a miss in %s and records just one failure", async (mode) => {
  await render(createElement(WriteSession, { deckId: "deck", deckSide: "front", chineseLang: "zh-CN", backHref: "/", mode }));
  const toggle = [...container.querySelectorAll("label")].find((label) => label.textContent?.includes("3 more times"))!.querySelector("input")!;
  await act(async () => toggle.click());
  expect(localStorage.getItem("flashcards.repeat-mistakes.v1")).toBe("true");
  await typeAnswer("wrong");
  await click("Check answer");
  expect(container.textContent).toContain("0/3 correct repetitions");
  const posts = () => fetchMock.mock.calls.filter(([url]) => url === "/api/review");
  expect(posts()).toHaveLength(0);
  await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "4" })));
  expect(posts()).toHaveLength(0);
  // A second error does not count as one of the required correct copies.
  await click("Write again");
  await typeAnswer("wrong");
  await click("Check answer");
  expect(container.textContent).toContain("0/3 correct repetitions");
  for (let index = 1; index <= 3; index++) {
    await click("Write again");
    await typeAnswer(mode === "write" ? "你好" : "ni3 hao3");
    await click("Check answer");
    expect(container.textContent).toContain(`${index}/3`);
    expect(posts()).toHaveLength(0);
  }
  await click("Continue");
  expect(posts()).toHaveLength(1);
  expect(JSON.parse(posts()[0][1]!.body as string).rating).toBe(1);
  expect(cardForMode(card, mode).practice).toMatchObject({ failures: 1, successes: 0, correctStreak: 0 });
  expect(cardForMode(card, mode).fsrs.reps).toBe(1);
  expect(card.fsrs.reps).toBe(0);
  expect(container.textContent).toContain("Next card is still learning");
});

it("leaves a correct first answer free to move on when the drill is enabled", async () => {
  localStorage.setItem("flashcards.repeat-mistakes.v1", "true");
  await render(createElement(WriteSession, { deckId: "deck", deckSide: "front", chineseLang: "zh-CN", backHref: "/" }));
  await typeAnswer("你好");
  await click("Check answer");
  await click("Good");
  expect(container.textContent).toContain("Session complete");
  expect(card.modes?.write?.practice?.correctStreak).toBe(1);
});

it.each(["review", "write", "pinyin"] as const)("does not loop duplicate/reverse words after Good in %s, including after reopening", async (mode) => {
  siblings = [{ ...card, id: "copy" }, { ...card, id: "reverse", front: card.back, back: card.front }];
  const element = mode === "review"
    ? createElement(ReviewSession, { deckId: "deck", deckLangs: {}, backHref: "/" })
    : createElement(WriteSession, { deckId: "deck", deckSide: "front", chineseLang: "zh-CN", backHref: "/", mode });
  await render(element);
  expect(container.textContent).toContain("1 left");
  if (mode === "review") await click("Show answer");
  else { await typeAnswer(mode === "write" ? "你好" : "ni3 hao3"); await click("Check answer"); }
  await click("Good");
  expect(container.textContent).toContain("Session complete");
  expect(Date.parse(cardForMode(card, mode).fsrs.due) - now.getTime()).toBeGreaterThanOrEqual(86_400_000);
  await act(async () => root.unmount());
  root = createRoot(container);
  await render(element);
  expect(container.textContent).toContain("Nothing due");
});

it("keeps a hard marker when a Retry word returns and allows removing it", async () => {
  await render(createElement(ReviewSession, { deckId: "deck", deckLangs: {}, backHref: "/" }));
  await click("☆ Mark as hard");
  expect(card.hard).toBe(true);
  await click("Show answer");
  await click("Retry");
  await act(async () => vi.advanceTimersByTimeAsync(59_000));
  await act(async () => vi.advanceTimersByTimeAsync(1_000));
  expect(container.textContent).toContain("★ In Hard Words");
  await click("★ In Hard Words");
  expect(card.hard).toBe(false);
  expect(card.fsrs.reps).toBe(1);
});
