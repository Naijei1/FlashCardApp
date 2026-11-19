// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import GroupSession, { groupQueueUrl } from "@/components/GroupSession";
import { emptyCardState } from "@/lib/fsrs";
import { buildGroupQueue, groupEntries } from "@/lib/group-study";
import { cardForMode, rateMode } from "@/lib/modes";
import { isStudyRoute } from "@/lib/progress-refresh";
import type { Card, Deck, ReviewMode, StoredFsrs } from "@/lib/types";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => createElement("a", { href }, children),
}));
vi.mock("@/components/TtsButton", () => ({ default: () => null }));

const now = new Date("2026-11-18T15:00:00Z");
const at = "2026-10-01T00:00:00.000Z";
const tz = "America/New_York";
const decks: Deck[] = [
  { id: "l6", name: "Lesson 6", createdAt: at, updatedAt: at, frontLanguage: "zh-CN", backLanguage: "en-US", source: "global", releaseWeek: 6 },
  { id: "l8", name: "Lesson 8", createdAt: at, updatedAt: at, frontLanguage: "zh-CN", backLanguage: "en-US", source: "global", releaseWeek: 8 },
];

let cards: Card[];
let posted: Array<{ cardId: string; deckId: string; mode: ReviewMode; rating: number; reviewedAt: string }>;
let failedStats: boolean;
let snapshots: unknown[];
let examDate: string | undefined;
let root: Root;
let container: HTMLDivElement;

function card(id: string, deckId: string, front: string, back: string, fsrs: StoredFsrs = emptyCardState(new Date(at))): Card {
  return { id, deckId, front, back, createdAt: at, updatedAt: at, fsrs };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  localStorage.clear();
  posted = [];
  snapshots = [];
  failedStats = false;
  examDate = undefined;
  cards = [
    card("a", "l6", "老师", "teacher"),
    card("a-rev", "l6", "teacher", "老师"),
    card("a8", "l8", "老师", "teacher"),
  ];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/practice-groups/g1/sessions") {
      snapshots.push(JSON.parse(init!.body as string));
      return { ok: !failedStats, status: failedStats ? 503 : 204 };
    }
    if (url === "/api/review") {
      const body = JSON.parse(init!.body as string);
      posted.push(body);
      cards = cards.map((c) => c.id === body.cardId && c.deckId === body.deckId
        ? rateMode(c, body.mode, body.rating, new Date(body.reviewedAt)).card : c);
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    const query = new URL(url, "https://app.test").searchParams;
    const data = buildGroupQueue(groupEntries(cards, decks), {
      group: { examDate }, decks, now: new Date(), timeZone: tz,
      mode: query.get("mode") as ReviewMode, plan: query.get("plan") as "today" | "all", random: () => 0,
    });
    return { ok: true, json: async () => JSON.parse(JSON.stringify(data)) };
  }));
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

async function flush() {
  for (let i = 0; i < 20; i++) await act(async () => { await Promise.resolve(); });
}

async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find((item) => item.textContent?.startsWith(label));
  expect(button, label).toBeTruthy();
  await act(async () => button!.click());
}

function session(mode: ReviewMode, plan: "today" | "all") {
  return createElement(GroupSession, {
    groupId: "g1", mode, plan, deckLangs: {}, chineseLang: "zh-CN", backHref: "/groups/g1",
  });
}

it("saves a recognition rating through /api/review to every merged copy", async () => {
  await act(async () => root.render(session("review", "today")));
  await flush();
  expect(container.textContent).toContain("老师");
  // The normal four rating buttons.
  await click("Show answer");
  for (const label of ["Retry", "Hard", "Good", "Easy"]) {
    expect([...container.querySelectorAll("button")].some((b) => b.textContent?.startsWith(label)), label).toBe(true);
  }
  await click("Good");
  await flush();
  expect(posted.map((review) => [review.deckId, review.cardId, review.mode, review.rating])).toEqual([
    ["l6", "a", "review", 3], ["l6", "a-rev", "review", 3], ["l8", "a8", "review", 3],
  ]);
  expect(new Set(posted.map((review) => review.reviewedAt)).size).toBe(1);
  expect(cards.every((c) => c.fsrs.reps === 1)).toBe(true);
  // Nothing is left in the offline queue once the server acknowledged each copy.
  expect(Object.keys(localStorage).filter((key) => key.includes("review"))).toEqual([]);
});

it("saves writing ratings to the write skill of every copy, leaving recognition alone", async () => {
  await act(async () => root.render(session("write", "all")));
  await flush();
  await click("Don't know");
  await click("Good");
  await flush();
  expect(posted.map((review) => review.mode)).toEqual(["write", "write", "write"]);
  expect(cards.every((c) => cardForMode(c, "write").fsrs.reps === 1 && c.fsrs.reps === 0)).toBe(true);
});

it("shows an exam-due card whose FSRS due date is later instead of parking it", async () => {
  const last = "2026-11-10T15:00:00Z";
  const weak: StoredFsrs = {
    due: "2027-01-01T00:00:00.000Z", stability: 4, difficulty: 5, elapsed_days: 0, scheduled_days: 52,
    learning_steps: 0, reps: 3, lapses: 0, state: 2, last_review: last,
  };
  cards = cards.map((c) => ({ ...c, fsrs: weak }));
  examDate = "2026-11-19";
  await act(async () => root.render(session("review", "today")));
  await flush();
  expect(container.textContent).toContain("老师");
  await click("Show answer");
  await click("Easy");
  await flush();
  expect(posted).toHaveLength(3);
  expect(container.textContent).not.toContain("Show answer");
});

it("shows each lesson at completion and retries the same summary independently of card saves", async () => {
  failedStats = true;
  await act(async () => root.render(createElement(GroupSession, {
    groupId: "g1", mode: "write", plan: "all", deckLangs: {}, chineseLang: "zh-CN", backHref: "/groups/g1",
    lessonNames: { l6: "Lesson 6", l8: "Lesson 8" }, previous: {
      id: "prev", startedAt: at, mode: "write", lessons: { l6: [1, 2, 2, 0] },
    },
  })));
  await flush();
  await click("Don't know");
  await click("Easy");
  await flush();
  expect(container.textContent).toContain("Lesson 61 rating · 0% struggleDown from 60% last session");
  expect(container.textContent).toContain("Lesson 81 rating · 0% struggleNo ratings last session");
  expect(snapshots[0]).toMatchObject({ mode: "write", lessons: { l6: [0, 0, 0, 1], l8: [0, 0, 0, 1] } });
  failedStats = false;
  await click("Retry lesson stats");
  await flush();
  expect(snapshots).toEqual([snapshots[0], snapshots[0]]);
  expect(container.textContent).not.toContain("Retry lesson stats");
  expect(posted).toHaveLength(3);
});

it("can finish a partial group session and see its first-session summary", async () => {
  cards.push(card("b", "l6", "朋友", "friend"));
  await act(async () => root.render(session("review", "all")));
  await flush();
  await click("Show answer");
  await click("Easy");
  await flush();
  await click("Finish");
  expect(container.textContent).toContain("1 card left in this batch");
  expect(container.textContent).toContain("First recorded recognition session");
  expect(container.textContent).toContain("1 rating · 0% struggle");
});

it("keeps group study screens out of progress refreshes and targets the group queue", () => {
  expect(isStudyRoute("/cram/g1")).toBe(true);
  expect(groupQueueUrl("g1", "write", "today", true)).toBe("/api/practice-groups/g1/queue?mode=write&plan=today&new=1");
});
