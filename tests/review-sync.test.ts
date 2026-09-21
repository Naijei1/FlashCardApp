import { afterEach, describe, expect, it, vi } from "vitest";

const STORAGE_KEY_PREFIX = "flashcards.pending-review.v2:";

function reviewKeys(storage: Storage): string[] {
  return Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(
    (key): key is string => !!key?.startsWith(STORAGE_KEY_PREFIX)
  );
}

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

class BrowserWindow extends EventTarget {
  constructor(readonly localStorage: Storage) {
    super();
  }
}

type MutableNavigator = { onLine: boolean };

function installBrowser(storage = new MemoryStorage(), online = true) {
  const browserWindow = new BrowserWindow(storage);
  const navigatorState: MutableNavigator = { onLine: online };
  vi.stubGlobal("window", browserWindow);
  vi.stubGlobal("navigator", navigatorState);
  return { browserWindow, navigatorState, storage };
}

function dispatchStorage(
  browserWindow: BrowserWindow,
  key: string,
  newValue: string | null
) {
  const event = new Event("storage") as StorageEvent;
  Object.defineProperties(event, {
    key: { value: key },
    newValue: { value: newValue },
  });
  browserWindow.dispatchEvent(event);
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("review background sync", () => {
  it("does not spin while busy and recovers from a hung request without losing reviews", async () => {
    installBrowser();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const fetchMock = vi.fn()
      .mockImplementationOnce((_url: string, init: RequestInit) => new Promise((_, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("request timed out")));
      }))
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    const { createReviewSync } = await import("@/components/reviewSync");
    const sync = createReviewSync(vi.fn());
    sync.push({ cardId: "card-a", deckId: "deck", rating: 3 });
    sync.push({ cardId: "card-b", deckId: "deck", rating: 3 });

    // Only the request timeout is scheduled while the single slot is busy.
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sync.getState()).toMatchObject({ pendingCount: 1, failedCount: 1 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual(
      JSON.parse(fetchMock.mock.calls[0][1].body)
    );
    expect(sync.getState().pendingCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("restores an offline review after reload with the same id and timestamp", async () => {
    const { navigatorState, storage } = installBrowser(undefined, false);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);

    const firstModule = await import("@/components/reviewSync");
    const firstSync = firstModule.createReviewSync(vi.fn());
    const clientReviewId = firstSync.push({
      cardId: "card-1",
      deckId: "deck-1",
      rating: 3,
      reviewedAt: "2026-09-03T14:00:00.000Z",
    });
    const storedKey = reviewKeys(storage)[0];
    const storedBeforeReload = JSON.parse(storage.getItem(storedKey) || "null");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(storedBeforeReload.clientReviewId).toBe(clientReviewId);

    // Simulate a page reload: a fresh module/engine reads the same localStorage.
    vi.resetModules();
    navigatorState.onLine = true;
    const secondModule = await import("@/components/reviewSync");
    const secondSync = secondModule.createReviewSync(vi.fn());
    expect(secondSync.getState().pendingCount).toBe(1);

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.clientReviewId).toBe(clientReviewId);
    expect(body.reviewedAt).toBe("2026-09-03T14:00:00.000Z");
    await vi.waitFor(() => expect(reviewKeys(storage)).toHaveLength(0));
  });

  it("serializes reviews while preserving per-card order", async () => {
    installBrowser();
    const requests: Array<{
      body: Record<string, unknown>;
      resolve: (response: { ok: boolean; status: number; json?: () => Promise<{ ok: boolean }> }) => void;
    }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) =>
        new Promise((resolve) => {
          requests.push({
            body: JSON.parse(init.body as string),
            resolve: resolve as (response: { ok: boolean; status: number; json?: () => Promise<{ ok: boolean }> }) => void,
          });
        })
      )
    );

    const { createReviewSync } = await import("@/components/reviewSync");
    const sync = createReviewSync(vi.fn());
    sync.push({
      cardId: "card-a",
      deckId: "deck",
      rating: 1,
      clientReviewId: "review_card_a_01",
      reviewedAt: "2026-09-03T14:00:00.000Z",
    });
    sync.push({
      cardId: "card-a",
      deckId: "deck",
      rating: 3,
      clientReviewId: "review_card_a_02",
      reviewedAt: "2026-09-03T14:01:00.000Z",
    });
    sync.push({
      cardId: "card-b",
      deckId: "deck",
      rating: 4,
      clientReviewId: "review_card_b_01",
      reviewedAt: "2026-09-03T14:00:30.000Z",
    });

    expect(requests.map((item) => item.body.clientReviewId)).toEqual([
      "review_card_a_01",
    ]);

    requests[0].resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1].body.clientReviewId).toBe("review_card_a_02");
    requests[1].resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
    await vi.waitFor(() => expect(requests).toHaveLength(3));
    expect(requests[2].body.clientReviewId).toBe("review_card_b_01");
    requests[2].resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
    await vi.waitFor(() => expect(sync.getState().pendingCount).toBe(0));
  });

  it("retries a failed request on reconnect without changing its identity", async () => {
    const { browserWindow } = installBrowser();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    const failures: number[] = [];

    const { createReviewSync } = await import("@/components/reviewSync");
    const sync = createReviewSync((count) => failures.push(count));
    sync.push({ cardId: "card-1", deckId: "deck-1", rating: 2 });

    await vi.waitFor(() => expect(failures).toContain(1));
    browserWindow.dispatchEvent(new Event("online"));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(secondBody).toEqual(firstBody);
    await vi.waitFor(() => expect(failures.at(-1)).toBe(0));
    expect(sync.getState().pendingCount).toBe(0);
  });

  it("lets the user discard a terminal failure instead of blocking forever", async () => {
    const { storage } = installBrowser();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    const { createReviewSync } = await import("@/components/reviewSync");
    const sync = createReviewSync(vi.fn());

    sync.push({ cardId: "deleted-card", deckId: "deck-1", rating: 3 });
    await vi.waitFor(() => expect(sync.getState().blockedCount).toBe(1));
    expect(sync.getState().pendingCount).toBe(1);

    sync.discardBlocked();
    expect(sync.getState()).toMatchObject({
      pendingCount: 0,
      failedCount: 0,
      blockedCount: 0,
    });
    expect(reviewKeys(storage)).toHaveLength(0);
  });

  it("merges independent per-review keys from another tab", async () => {
    const { browserWindow, storage } = installBrowser(undefined, false);
    vi.stubGlobal("fetch", vi.fn());
    const { createReviewSync } = await import("@/components/reviewSync");
    const sync = createReviewSync(vi.fn());
    sync.push({
      cardId: "card-a",
      deckId: "deck-1",
      rating: 3,
      clientReviewId: "review_from_tab_a",
      reviewedAt: "2026-09-03T14:00:00.000Z",
    });

    const other = {
      cardId: "card-b",
      deckId: "deck-1",
      rating: 2,
      clientReviewId: "review_from_tab_b",
      reviewedAt: "2026-09-03T14:01:00.000Z",
      attempts: 0,
      failed: true,
      retryable: true,
      nextAttemptAt: null,
    };
    const otherKey = `${STORAGE_KEY_PREFIX}${other.clientReviewId}`;
    const serialized = JSON.stringify(other);
    storage.setItem(otherKey, serialized);
    dispatchStorage(browserWindow, otherKey, serialized);

    expect(sync.getState().pendingCount).toBe(2);
    expect(reviewKeys(storage)).toHaveLength(2);

    const firstKey = `${STORAGE_KEY_PREFIX}review_from_tab_a`;
    storage.removeItem(firstKey);
    dispatchStorage(browserWindow, firstKey, null);
    expect(sync.getState().pendingCount).toBe(1);
    expect(reviewKeys(storage)).toEqual([otherKey]);
  });
});

it("retains a review when a proxy or login page responds with HTTP 200 instead of an acknowledgement", async () => {
  installBrowser();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new Error("HTML, not JSON"); } })
    .mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
  vi.stubGlobal("fetch", fetchMock);
  const { createReviewSync } = await import("@/components/reviewSync");
  const sync = createReviewSync(vi.fn());
  sync.push({ cardId: "card", deckId: "deck", rating: 4 });
  await vi.advanceTimersByTimeAsync(0);
  expect(sync.getState()).toMatchObject({ pendingCount: 1, failedCount: 1 });
  await vi.advanceTimersByTimeAsync(1000);
  expect(sync.getState().pendingCount).toBe(0);
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(JSON.parse(fetchMock.mock.calls[1][1].body));
});

it("preserves a writing-mode review across an offline reload", async () => {
  const { storage } = installBrowser(undefined, false);
  const { createReviewSync } = await import("@/components/reviewSync");
  createReviewSync(vi.fn()).push({ cardId: "a", deckId: "d", rating: 1, mode: "pinyin" });
  await Promise.resolve();
  expect(JSON.parse(storage.getItem(reviewKeys(storage)[0])!).mode).toBe("pinyin");
  vi.resetModules();
  installBrowser(storage, true);
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  vi.stubGlobal("fetch", fetchMock);
  const restored = await import("@/components/reviewSync");
  restored.createReviewSync(vi.fn()).getState();
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).mode).toBe("pinyin");
});
