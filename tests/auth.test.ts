import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkPassword, signSession, verifySessionToken } from "@/lib/auth";

beforeEach(() => {
  vi.stubEnv("APP_PASSWORD", "1212");
  vi.stubEnv("SESSION_SECRET", "a".repeat(64));
  vi.stubEnv("APP_PASSWORD_HEX", "");
  vi.stubEnv("SESSION_SECRET_HEX", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("checkPassword", () => {
  it("accepts the correct password", () => {
    expect(checkPassword("1212")).toBe(true);
  });
  it("preserves an existing production password during an application upgrade", () => {
    vi.stubEnv("NODE_ENV", "production");
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

  it("round-trips an encoded password with dotenv metacharacters", () => {
    const password = 'abcdefghijkl"q\\z$NO_SUCH#tail\n\u5bc6\u7801';
    vi.stubEnv("APP_PASSWORD", "wrong-build-time-value");
    vi.stubEnv("APP_PASSWORD_HEX", Buffer.from(password, "utf8").toString("hex"));
    expect(checkPassword(password)).toBe(true);
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

  it("uses the encoded production session secret", async () => {
    const secret = 'session"\\$#\n\u5bc6'.repeat(4);
    vi.stubEnv("SESSION_SECRET", "wrong-build-time-value".repeat(2));
    vi.stubEnv("SESSION_SECRET_HEX", Buffer.from(secret, "utf8").toString("hex"));
    const token = await signSession();
    expect(await verifySessionToken(token)).toBe(true);
  });
});
