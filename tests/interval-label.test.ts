import { describe, expect, it } from "vitest";
import { formatInterval } from "@/lib/interval-label";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("formatInterval", () => {
  it("formats sub-minute as <1m", () => {
    expect(formatInterval(30_000)).toBe("<1m");
  });
  it("formats minutes", () => {
    expect(formatInterval(10 * MIN)).toBe("10m");
  });
  it("formats hours", () => {
    expect(formatInterval(5 * HOUR)).toBe("5h");
  });
  it("formats days", () => {
    expect(formatInterval(3 * DAY)).toBe("3d");
  });
  it("formats months", () => {
    expect(formatInterval(75 * DAY)).toBe("2.5mo");
  });
  it("formats years", () => {
    expect(formatInterval(400 * DAY)).toBe("1.1yr");
  });
});
