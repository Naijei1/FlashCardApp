import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkPassword, signSession, verifySessionToken } from "@/lib/auth";

beforeEach(() => {
  vi.stubEnv("APP_PASSWORD", "1212");
  vi.stubEnv("SESSION_SECRET", "a".repeat(64));
});
afterEach(() => vi.unstubAllEnvs());

describe("checkPassword", () => {
  it("accepts the correct password", () => {
    expect(checkPassword("1212")).toBe(true);
  });
  it("rejects wrong and different-length passwords", () => {
    expect(checkPassword("1213")).toBe(false);
    expect(checkPassword("")).toBe(false);
    expect(checkPassword("12121212")).toBe(false);
  });
  it("rejects everything when APP_PASSWORD is unset", () => {
    vi.stubEnv("APP_PASSWORD", "");
    expect(checkPassword("")).toBe(false);
  });
});

describe("session tokens", () => {
  it("verifies a freshly signed token", async () => {
    const token = await signSession();
    expect(await verifySessionToken(token)).toBe(true);
  });

  it("rejects a tampered token", async () => {
    const token = await signSession();
    expect(await verifySessionToken(token.slice(0, -2) + "xx")).toBe(false);
  });

  it("rejects an expired token", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-28T12:00:00Z"));
    const token = await signSession();
    vi.setSystemTime(new Date("2026-09-29T12:00:00Z")); // 32 days later
    expect(await verifySessionToken(token)).toBe(false);
    vi.useRealTimers();
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await signSession();
    vi.stubEnv("SESSION_SECRET", "b".repeat(64));
    expect(await verifySessionToken(token)).toBe(false);
  });
});
