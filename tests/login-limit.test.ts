import { describe, expect, it } from "vitest";
import {
  LOGIN_FREE_ATTEMPTS,
  LOGIN_WINDOW_MS,
  limitLogin,
  type AttemptExpectation,
  type AttemptState,
  type AttemptStore,
} from "@/lib/login-limit";

function memoryStore(): AttemptStore & { state: AttemptState | null } {
  const store = {
    state: null as AttemptState | null,
    async get() {
      return store.state ? { ...store.state } : null;
    },
    async save(_key: string, next: AttemptState, expected: AttemptExpectation) {
      if (expected === "absent") {
        if (store.state) return false;
      } else if (
        !store.state ||
        store.state.failures !== expected.failures ||
        store.state.windowStartedAt !== expected.windowStartedAt
      ) {
        return false;
      }
      store.state = { ...next };
      return true;
    },
    async delete() {
      store.state = null;
    },
  };
  return store;
}

describe("durable login limiter", () => {
  it("blocks the attempt after the free allowance, across a fresh store read", async () => {
    const store = memoryStore();
    const start = Date.parse("2026-10-23T12:00:00Z");
    for (let i = 0; i < LOGIN_FREE_ATTEMPTS; i++) {
      const result = await limitLogin(store, "client", start + i, () => false);
      expect(result.status).toBe("rejected");
    }
    const arming = await limitLogin(store, "client", start + 10, () => false);
    expect(arming.status).toBe("rejected");
    const blocked = await limitLogin(store, "client", start + 11, () => false);
    expect(blocked).toEqual({ status: "blocked", retryAfterSeconds: 2 });
    const stillBlocked = await limitLogin(store, "client", start + 12, async () => {
      throw new Error("password must not be checked while blocked");
    });
    expect(stillBlocked.status).toBe("blocked");
  });

  it("shares one counter the way separate server instances would", async () => {
    const store = memoryStore();
    const now = 1_700_000_000_000;
    const results = [];
    for (let i = 0; i < 8; i++) {
      results.push(await limitLogin(store, "client", now + i, () => false));
    }
    expect(results.slice(0, LOGIN_FREE_ATTEMPTS).every((result) => result.status === "rejected")).toBe(true);
    expect(results.some((result) => result.status === "blocked")).toBe(true);
  });

  it("clears the counter after the right password and starts a new window later", async () => {
    const store = memoryStore();
    const now = 1_700_000_000_000;
    await limitLogin(store, "client", now, () => false);
    expect(await limitLogin(store, "client", now + 1, () => true)).toEqual({ status: "allowed" });
    expect(store.state).toBeNull();
    await limitLogin(store, "client", now + LOGIN_WINDOW_MS + 5, () => false);
    expect(store.state?.failures).toBe(1);
    expect(store.state?.windowStartedAt).toBe(now + LOGIN_WINDOW_MS + 5);
  });

  it("retries when two writers race the same counter", async () => {
    const store = memoryStore();
    let conflicts = 0;
    const original = store.save.bind(store);
    store.save = async (key, next, expected) => {
      if (conflicts === 0 && expected !== "absent") {
        conflicts += 1;
        return false;
      }
      return original(key, next, expected);
    };
    const first = await limitLogin(store, "client", 100, () => false);
    expect(first.status).toBe("rejected");
    const raced = await limitLogin(store, "client", 101, () => false);
    expect(raced.status).toBe("rejected");
    expect(store.state?.failures).toBe(2);
  });
});
