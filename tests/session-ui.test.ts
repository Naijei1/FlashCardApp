// @vitest-environment jsdom
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ReviewPage from "@/app/(app)/review/[deckId]/page";
import WritePage from "@/app/(app)/write/[deckId]/page";
import PinyinPage from "@/app/(app)/pinyin/[deckId]/page";
import ReviewSession from "@/components/ReviewSession";
import WriteSession from "@/components/WriteSession";
import { applyRating, emptyCardState, previewIntervals, Rating } from "@/lib/fsrs";
import { buildReviewQueueData } from "@/lib/review-queue";
import { buildPinyinQueueData } from "@/lib/pinyin-queue";
import { formatInterval } from "@/lib/interval-label";
import type { Card } from "@/lib/types";

const db = vi.hoisted(() => ({ getDeck: vi.fn(), listDecks: vi.fn(), listCards: vi.fn() }));
vi.mock("@/lib/db", () => db);
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not found"); } }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => createElement("a", { href }, children) }));
vi.mock("@/components/TtsButton", () => ({ default: () => null }));

const now = new Date("2026-09-16T12:00:00Z");
let root: Root;
let container: HTMLDivElement;
let card: Card;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  vi.setSystemTime(now);
  localStorage.clear();
  card = { id: "card", deckId: "deck", front: "你好", back: "hello", createdAt: now.toISOString(), updatedAt: now.toISOString(), fsrs: emptyCardState(now) };
  const deck = { id: "deck", name: "Chinese", frontLanguage: "zh-CN" };
  db.getDeck.mockResolvedValue(deck);
  db.listDecks.mockResolvedValue([deck]);
  db.listCards.mockImplementation(async () => [card]);
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/review") {
      const body = JSON.parse(init!.body as string);
      card = { ...card, fsrs: applyRating(card.fsrs, body.rating, new Date(body.reviewedAt)).fsrs };
      return { ok: true, status: 200 };
    }
    const data = url.includes("mode=pinyin") ? buildPinyinQueueData([card], "front", new Date()) : buildReviewQueueData([card], new Date());
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

it.each([["review", ReviewPage], ["write", WritePage], ["pinyin", PinyinPage]] as const)("revalidates a cached %s page after an Easy review", async (_mode, page) => {
  const cachedPage = await page({ params: Promise.resolve({ deckId: "deck" }) });
  await render(cachedPage);
  if (page === ReviewPage) await click("Show answer");
  else await click("Don't know");
  await click("Easy");
  expect(card.fsrs.reps).toBe(1);
  await act(async () => root.unmount());
  root = createRoot(container);
  await render(cachedPage);
  expect(container.textContent).toContain("Nothing due");
  expect(container.querySelector("#write-input")).toBeNull();
});

it.each(["review", "write", "pinyin"])("refreshes interval labels after a long pause in %s", async (mode) => {
  card.fsrs = applyRating(card.fsrs, Rating.Good, now).fsrs;
  vi.setSystemTime(new Date(card.fsrs.due));
  const element = mode === "review"
    ? createElement(ReviewSession, { deckId: "deck", deckLangs: {}, backHref: "/" })
    : createElement(WriteSession, { deckId: "deck", deckSide: "front", chineseLang: "zh-CN", backHref: "/", mode: mode as "write" | "pinyin" });
  await render(element);
  vi.setSystemTime(new Date(now.getTime() + 3 * 86_400_000));
  await act(async () => window.dispatchEvent(new Event("focus")));
  if (mode === "review") await click("Show answer");
  else await click("Don't know");
  const expected = previewIntervals(card.fsrs, new Date());
  const good = [...container.querySelectorAll("button")].find((button) => button.textContent?.startsWith("Good"));
  expect(good?.querySelector("span")?.textContent).toBe(expected.good);
  const ratedAt = Date.now();
  await click("Good");
  expect(formatInterval(Date.parse(card.fsrs.due) - ratedAt)).toBe(expected.good);
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
