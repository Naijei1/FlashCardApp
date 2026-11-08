// @vitest-environment jsdom
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { REFRESH_COALESCE_MS, RESUME_REFRESH_GAP_MS } from "@/lib/progress-refresh";

const nav = vi.hoisted(() => ({ pathname: "/", refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ refresh: nav.refresh }),
}));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  vi.setSystemTime(new Date("2026-09-16T12:00:00Z"));
  nav.pathname = "/";
  nav.refresh.mockReset();
  localStorage.clear();
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.restoreAllMocks();
});

async function render(element: ReactElement) {
  await act(async () => root.render(element));
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function loadRefresh() {
  const scope = await import("@/lib/browser-user-scope");
  scope.bindLocalUser("user-a");
  const { default: ProgressRefresh } = await import("@/components/ProgressRefresh");
  const { default: ReviewSyncBanner } = await import("@/components/ReviewSyncBanner");
  const sync = await import("@/components/reviewSync");
  return { scope, ProgressRefresh, ReviewSyncBanner, ...sync };
}

function setVisibility(value: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => value });
  document.dispatchEvent(new Event("visibilitychange"));
}

function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => value });
}

it("does not refresh a summary page on first paint", async () => {
  const { ProgressRefresh } = await loadRefresh();
  await render(createElement(ProgressRefresh));
  await advance(REFRESH_COALESCE_MS);
  expect(nav.refresh).not.toHaveBeenCalled();
});

it("refreshes home after leaving a review, and not while the session is still open", async () => {
  nav.pathname = "/review/all";
  const { ProgressRefresh } = await loadRefresh();
  await render(createElement(ProgressRefresh));
  window.dispatchEvent(new Event("blur"));
  setVisibility("hidden");
  setVisibility("visible");
  window.dispatchEvent(new Event("focus"));
  await advance(REFRESH_COALESCE_MS);
  expect(nav.refresh).not.toHaveBeenCalled();

  nav.pathname = "/";
  await render(createElement(ProgressRefresh));
  await advance(REFRESH_COALESCE_MS);
  expect(nav.refresh).toHaveBeenCalledTimes(1);
});

it("refreshes once when focus, visibility, and pageshow resume together", async () => {
  const { ProgressRefresh } = await loadRefresh();
  await render(createElement(ProgressRefresh));
  window.dispatchEvent(new Event("pagehide"));
  setVisibility("hidden");
  setVisibility("visible");
  window.dispatchEvent(new Event("focus"));
  window.dispatchEvent(new Event("pageshow"));
  await advance(REFRESH_COALESCE_MS);
  expect(nav.refresh).toHaveBeenCalledTimes(1);
  nav.refresh.mockClear();
  window.dispatchEvent(new Event("focus"));
  await advance(RESUME_REFRESH_GAP_MS);
  expect(nav.refresh).not.toHaveBeenCalled();
});

it("refreshes again after the resume gap when the app was backgrounded", async () => {
  const { ProgressRefresh } = await loadRefresh();
  await render(createElement(ProgressRefresh));
  window.dispatchEvent(new Event("blur"));
  window.dispatchEvent(new Event("focus"));
  await advance(REFRESH_COALESCE_MS);
  expect(nav.refresh).toHaveBeenCalledTimes(1);
  nav.refresh.mockClear();
  await advance(RESUME_REFRESH_GAP_MS);
  window.dispatchEvent(new Event("blur"));
  window.dispatchEvent(new Event("focus"));
  await advance(REFRESH_COALESCE_MS);
  expect(nav.refresh).toHaveBeenCalledTimes(1);
});

it("refreshes after a saved review reaches the server and ignores a failed write", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ error: "unavailable" }) })
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) });
  vi.stubGlobal("fetch", fetchMock);
  const { ProgressRefresh, createReviewSync } = await loadRefresh();
  await render(createElement(ProgressRefresh));
  const sync = createReviewSync(vi.fn());
  sync.push({
    cardId: "card-1",
    deckId: "deck-1",
    rating: 1,
    clientReviewId: "review_fail_then1",
    reviewedAt: "2026-09-16T12:00:00.000Z",
  });
  await advance(0);
  await advance(REFRESH_COALESCE_MS);
  expect(nav.refresh).not.toHaveBeenCalled();
  expect(sync.getState().failedCount).toBe(1);

  await advance(1000);
  await advance(REFRESH_COALESCE_MS);
  expect(sync.getState().pendingCount).toBe(0);
  expect(nav.refresh).toHaveBeenCalledTimes(1);
});

it("waits out a burst of saved reviews and refreshes the summary once", async () => {
  let release: (value: { ok: boolean; status: number; json: () => Promise<{ ok: boolean }> }) => void = () => {};
  const fetchMock = vi.fn(
    () => new Promise<{ ok: boolean; status: number; json: () => Promise<{ ok: boolean }> }>((resolve) => {
      release = resolve;
    })
  );
  vi.stubGlobal("fetch", fetchMock);
  const { ProgressRefresh, createReviewSync } = await loadRefresh();
  await render(createElement(ProgressRefresh));
  const sync = createReviewSync(vi.fn());
  sync.push({ cardId: "card-a", deckId: "deck", rating: 3, clientReviewId: "review_burst_aaa", reviewedAt: "2026-09-16T12:00:00.000Z" });
  sync.push({ cardId: "card-b", deckId: "deck", rating: 3, clientReviewId: "review_burst_bbb", reviewedAt: "2026-09-16T12:00:01.000Z" });
  await advance(0);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  release({ ok: true, status: 200, json: async () => ({ ok: true }) });
  await advance(0);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  release({ ok: true, status: 200, json: async () => ({ ok: true }) });
  await advance(0);
  expect(sync.getState().pendingCount).toBe(0);
  expect(nav.refresh).not.toHaveBeenCalled();
  await advance(REFRESH_COALESCE_MS);
  expect(nav.refresh).toHaveBeenCalledTimes(1);
});

it("refreshes the signed-in account after an offline queue flushes and not the other account", async () => {
  setOnline(false);
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
  vi.stubGlobal("fetch", fetchMock);
  const { ProgressRefresh, createReviewSync, scope } = await loadRefresh();
  await render(createElement(ProgressRefresh));
  const sync = createReviewSync(vi.fn());
  sync.push({
    cardId: "card-1",
    deckId: "deck-1",
    rating: 4,
    mode: "pinyin",
    clientReviewId: "review_offline_a1",
    reviewedAt: "2026-09-16T12:00:00.000Z",
  });
  await advance(REFRESH_COALESCE_MS);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(nav.refresh).not.toHaveBeenCalled();
  expect(sync.getState().pendingCount).toBe(1);

  setOnline(true);
  window.dispatchEvent(new Event("online"));
  await advance(0);
  await advance(REFRESH_COALESCE_MS);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).mode).toBe("pinyin");
  expect(sync.getState().pendingCount).toBe(0);
  expect(nav.refresh).toHaveBeenCalledTimes(1);

  nav.refresh.mockClear();
  scope.bindLocalUser("user-b");
  await advance(REFRESH_COALESCE_MS);
  expect(nav.refresh).not.toHaveBeenCalled();
  expect(sync.getState().pendingCount).toBe(0);
});

it("keeps a failed save visible on the summary screen without claiming it was stored", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: "not found" }) }));
  const { ProgressRefresh, ReviewSyncBanner, createReviewSync } = await loadRefresh();
  await render(createElement("div", null, createElement(ProgressRefresh), createElement(ReviewSyncBanner)));
  await act(async () => {
    createReviewSync(vi.fn()).push({
      cardId: "missing",
      deckId: "deck-1",
      rating: 2,
      clientReviewId: "review_blocked_01",
      reviewedAt: "2026-09-16T12:00:00.000Z",
    });
    await vi.advanceTimersByTimeAsync(0);
  });
  await advance(REFRESH_COALESCE_MS);
  expect(nav.refresh).not.toHaveBeenCalled();
  expect(container.textContent).toContain("cannot be saved");
  expect(container.textContent).not.toContain("Session complete");
  expect(container.textContent).not.toContain("Saved");
});
