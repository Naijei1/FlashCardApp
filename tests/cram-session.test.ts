// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import CramSession from "@/components/CramSession";
import type { CramCard } from "@/lib/cram";
import { isStudyRoute } from "@/lib/progress-refresh";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => createElement("a", { href }, children),
}));
vi.mock("@/components/TtsButton", () => ({ default: () => null }));

let root: Root;
let container: HTMLDivElement;
let fetchMock: ReturnType<typeof vi.fn>;
let beacon: ReturnType<typeof vi.fn>;

function cramCard(n: number): CramCard {
  return {
    key: `k${n}`,
    id: `card-${n}`,
    deckId: "l6",
    prompt: ["你好", "谢谢", "老师"][n],
    promptLang: "zh-CN",
    pinyin: ["nǐ hǎo", "xiè xie", "lǎo shī"][n],
    answer: ["hello", "thanks", "teacher"][n],
    answerLang: "en-US",
    sources: n === 2 ? ["Lesson 6", "Lesson 8"] : ["Lesson 6"],
  };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  sessionStorage.clear();
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
  vi.stubGlobal("fetch", fetchMock);
  beacon = vi.fn(() => true);
  Object.defineProperty(navigator, "sendBeacon", { value: beacon, configurable: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find((item) => item.textContent?.includes(label));
  expect(button, label).toBeTruthy();
  await act(async () => button!.click());
}

function prompt(): string {
  return container.querySelector(".hanzi")?.textContent ?? "";
}

it("runs a shuffled round with session-only stats and never saves reviews", async () => {
  const cards = [cramCard(0), cramCard(1), cramCard(2)];
  // Deterministic shuffle: reverse order.
  let calls = 0;
  const random = () => [0, 0][calls++ % 2];
  await act(async () => root.render(createElement(CramSession, { cards, backHref: "/groups/g1", title: "Final", random })));
  expect(container.textContent).toContain("1 / 3");
  expect(container.textContent).toContain("doesn’t change your review schedule");
  // No Hard Words star in cram mode: it would write progress.
  expect(container.querySelector("[aria-pressed]")).toBeNull();

  const seen: string[] = [];
  const outcomes = ["Missed", "Got it", "Missed"];
  for (const outcome of outcomes) {
    seen.push(prompt());
    await click("Show answer");
    await click(outcome);
  }
  expect(new Set(seen).size).toBe(3);
  expect(container.textContent).toContain("Round complete");
  expect(container.textContent).toMatch(/1\s*got it/);
  expect(container.textContent).toMatch(/2\s*missed/);

  await click("Re-drill 2 missed cards");
  expect(container.textContent).toContain("1 / 2");
  const redrilled = [prompt()];
  await click("Show answer");
  await click("Got it");
  redrilled.push(prompt());
  await click("Show answer");
  await click("Got it");
  expect(redrilled.sort()).toEqual([seen[0], seen[2]].sort());
  expect(container.textContent).toContain("Round complete");
  expect(container.textContent).not.toContain("Re-drill");

  await click("Shuffle all 3 cards again");
  expect(container.textContent).toContain("1 / 3");

  // Cram mode is read-only: no review API, no offline review queue, no beacons.
  expect(fetchMock).not.toHaveBeenCalled();
  expect(beacon).not.toHaveBeenCalled();
  expect(localStorage.length).toBe(0);
});

it("shows source lessons and undo restores the previous card", async () => {
  const cards = [cramCard(2), cramCard(0)];
  await act(async () => root.render(createElement(CramSession, { cards, backHref: "/", title: "Final", random: () => 0.99 })));
  expect(prompt()).toBe("老师");
  await click("Show answer");
  expect(container.textContent).toContain("lǎo shī");
  expect(container.textContent).toContain("In Lesson 6 · Lesson 8");
  await click("Missed");
  expect(container.textContent).toContain("2 / 2");
  expect(container.textContent).toContain("✗ 1");
  await click("Undo");
  expect(container.textContent).toContain("1 / 2");
  expect(container.textContent).toContain("✗ 0");
  expect(prompt()).toBe("老师");
  await click("Got it");
  expect(container.textContent).toContain("✓ 1");
});

it("undo on the completion screen corrects the final mark", async () => {
  const cards = [cramCard(0), cramCard(1)];
  await act(async () => root.render(createElement(CramSession, { cards, backHref: "/", title: "Final", random: () => 0.99 })));
  const first = prompt();
  await click("Show answer");
  await click("Got it");
  const last = prompt();
  await click("Show answer");
  await click("Missed");
  expect(container.textContent).toContain("Round complete");
  expect(container.textContent).toMatch(/1\s*missed/);
  expect(container.textContent).toContain("Re-drill 1 missed card");

  await click("Undo last answer");
  expect(container.textContent).not.toContain("Round complete");
  expect(container.textContent).toContain("2 / 2");
  expect(container.textContent).toContain("✓ 1");
  expect(container.textContent).toContain("✗ 0");
  expect(prompt()).toBe(last);
  expect(prompt()).not.toBe(first);

  await click("Got it");
  expect(container.textContent).toContain("Round complete");
  expect(container.textContent).toMatch(/2\s*got it/);
  expect(container.textContent).toMatch(/0\s*missed/);
  expect(container.textContent).not.toContain("Re-drill");
});

it("keeps the cram screen out of progress refreshes, like other study screens", () => {
  expect(isStudyRoute("/cram/g1")).toBe(true);
  expect(isStudyRoute("/groups/g1")).toBe(false);
});

it("does not wire cram mode to any review-saving module", async () => {
  const { readFileSync } = await import("node:fs");
  for (const file of ["components/CramSession.tsx", "app/(app)/cram/[groupId]/page.tsx", "lib/cram-set.ts", "lib/cram.ts"]) {
    const source = readFileSync(file, "utf8");
    for (const banned of ["reviewSync", "useStudyQueue", "/api/review", "HardWordButton", "commitReview", "setCardHard"]) {
      expect(source, `${file} must not use ${banned}`).not.toContain(banned);
    }
  }
});
