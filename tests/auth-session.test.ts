import { beforeEach, describe, expect, it, vi } from "vitest";

const sessions = vi.hoisted(() => ({
  current: vi.fn(),
  revoke: vi.fn(),
  revokeAll: vi.fn(),
  begin: vi.fn(),
  limit: vi.fn(),
}));

vi.mock("@/lib/auth-store", () => ({
  sessionIsCurrent: sessions.current,
  revokeSession: sessions.revoke,
  revokeAllSessions: sessions.revokeAll,
  beginSession: sessions.begin,
  limitSharedLogin: sessions.limit,
}));

const cookieJar = vi.hoisted(() => ({
  value: undefined as string | undefined,
  set: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (cookieJar.value ? { value: cookieJar.value } : undefined),
    set: cookieJar.set,
    delete: cookieJar.delete,
  }),
}));

import { getSession, signSession } from "@/lib/auth";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";

const CLAIMS = {
  userId: "shared",
  sessionId: "session-id-123456",
  sessionVersion: 3,
};

beforeEach(() => {
  vi.stubEnv("APP_PASSWORD", "1212");
  vi.stubEnv("SESSION_SECRET", "a".repeat(64));
  vi.stubEnv("APP_PASSWORD_HEX", "");
  vi.stubEnv("SESSION_SECRET_HEX", "");
  cookieJar.value = undefined;
  cookieJar.set.mockReset();
  cookieJar.delete.mockReset();
  sessions.current.mockReset();
  sessions.revoke.mockReset();
  sessions.revokeAll.mockReset();
  sessions.begin.mockReset();
  sessions.limit.mockReset();
});

describe("server-side session revocation", () => {
  it("accepts a signed session only while the store still has it", async () => {
    cookieJar.value = await signSession(CLAIMS);
    sessions.current.mockResolvedValue(true);
    expect(await getSession()).toEqual(CLAIMS);
    sessions.current.mockResolvedValue(false);
    expect(await getSession()).toBeNull();
    expect(sessions.current).toHaveBeenCalledWith(CLAIMS.userId, CLAIMS.sessionId, CLAIMS.sessionVersion);
  });

  it("logout deletes only the current session", async () => {
    cookieJar.value = await signSession(CLAIMS);
    const response = await logout(new Request("http://localhost/api/auth/logout", { method: "POST" }));
    expect(response.status).toBe(200);
    expect(sessions.revoke).toHaveBeenCalledWith(CLAIMS.userId, CLAIMS.sessionId);
    expect(sessions.revokeAll).not.toHaveBeenCalled();
    expect(cookieJar.delete).toHaveBeenCalled();
  });

  it("log out everywhere bumps the user session version", async () => {
    cookieJar.value = await signSession(CLAIMS);
    const response = await logout(new Request("http://localhost/api/auth/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ everywhere: true }),
    }));
    expect(response.status).toBe(200);
    expect(sessions.revokeAll).toHaveBeenCalledWith(CLAIMS.userId);
    expect(sessions.revoke).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/login", () => {
  it("returns 429 from the shared limiter and does not create a session", async () => {
    sessions.limit.mockResolvedValue({ status: "blocked", retryAfterSeconds: 4 });
    const response = await login(new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.8" },
      body: JSON.stringify({ password: "nope" }),
    }));
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("4");
    expect(sessions.begin).not.toHaveBeenCalled();
  });

  it("issues a revocable session after the limiter allows the password", async () => {
    sessions.limit.mockImplementation(async (_key: string, _now: number, check: () => Promise<boolean>) => {
      return (await check()) ? { status: "allowed" } : { status: "rejected" };
    });
    sessions.begin.mockResolvedValue({ sessionId: CLAIMS.sessionId, sessionVersion: 1 });
    const response = await login(new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "1212" }),
    }));
    expect(response.status).toBe(200);
    expect(cookieJar.set).toHaveBeenCalledWith(
      "session",
      expect.any(String),
      expect.objectContaining({ httpOnly: true, path: "/" })
    );
  });
});
