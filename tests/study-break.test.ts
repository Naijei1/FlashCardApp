import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BREAK_MS,
  clearBreak,
  formatCountdown,
  getBreakUntil,
  startBreak,
  type StudyBreakScope,
} from "@/lib/study-break";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

const reviewA: StudyBreakScope = { deckId: "deck/a", mode: "review" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("formatCountdown", () => {
  it("formats a full 5-minute break", () => {
    expect(formatCountdown(BREAK_MS)).toBe("5:00");
  });
  it("formats mid-break", () => {
    expect(formatCountdown(4 * 60_000 + 59_000)).toBe("4:59");
    expect(formatCountdown(61_000)).toBe("1:01");
  });
  it("rounds partial seconds up", () => {
    expect(formatCountdown(500)).toBe("0:01");
  });
  it("clamps at zero", () => {
    expect(formatCountdown(0)).toBe("0:00");
    expect(formatCountdown(-5000)).toBe("0:00");
  });
});

describe("persisted study breaks", () => {
  it("keeps breaks isolated by deck and study mode", () => {
    const localStorage = new MemoryStorage();
    vi.stubGlobal("window", { localStorage });

    const until = startBreak(reviewA, 1_000);
    expect(getBreakUntil(reviewA, 1_001)).toBe(until);
    expect(getBreakUntil({ deckId: "deck/b", mode: "review" }, 1_001)).toBe(0);
    expect(getBreakUntil({ deckId: "deck/a", mode: "write" }, 1_001)).toBe(0);
  });

  it("migrates the legacy global break once", () => {
    const localStorage = new MemoryStorage();
    localStorage.setItem("study-break-until", "9000");
    vi.stubGlobal("window", { localStorage });

    expect(getBreakUntil(reviewA, 1_000)).toBe(9_000);
    expect(localStorage.getItem("study-break-until")).toBeNull();
    expect(getBreakUntil(reviewA, 1_001)).toBe(9_000);
    expect(getBreakUntil({ deckId: "deck/b", mode: "review" }, 1_001)).toBe(0);
  });

  it("clears only the scoped value plus obsolete legacy state", () => {
    const localStorage = new MemoryStorage();
    vi.stubGlobal("window", { localStorage });
    startBreak(reviewA, 1_000);
    const other = { deckId: "deck/b", mode: "review" } as const;
    const otherUntil = startBreak(other, 2_000);
    localStorage.setItem("study-break-until", "9999");

    clearBreak(reviewA);

    expect(getBreakUntil(reviewA, 2_001)).toBe(0);
    expect(getBreakUntil(other, 2_001)).toBe(otherUntil);
    expect(localStorage.getItem("study-break-until")).toBeNull();
  });

  it("removes expired values", () => {
    const localStorage = new MemoryStorage();
    vi.stubGlobal("window", { localStorage });
    startBreak(reviewA, 1_000);

    expect(getBreakUntil(reviewA, 1_000 + BREAK_MS + 1)).toBe(0);
    expect(localStorage.length).toBe(0);
  });

  it("survives browsers that deny localStorage access", () => {
    const blockedWindow = Object.defineProperty({}, "localStorage", {
      get() {
        throw new Error("blocked");
      },
    });
    vi.stubGlobal("window", blockedWindow);

    expect(() => getBreakUntil(reviewA, 1_000)).not.toThrow();
    expect(startBreak(reviewA, 1_000)).toBe(1_000 + BREAK_MS);
    expect(() => clearBreak(reviewA)).not.toThrow();
  });
});
