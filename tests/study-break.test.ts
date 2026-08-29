import { describe, expect, it } from "vitest";
import { BREAK_MS, formatCountdown } from "@/lib/study-break";

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
