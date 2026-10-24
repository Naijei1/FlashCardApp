import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JWT } from "next-auth/jwt";
import type { Session } from "next-auth";

const sessions = vi.hoisted(() => ({
  current: vi.fn(),
  revoke: vi.fn(),
  revokeAll: vi.fn(),
  begin: vi.fn(),
  limit: vi.fn(),
}));

const authFns = vi.hoisted(() => ({
  auth: vi.fn(),
  signOut: vi.fn(),
}));

const cookieJar = vi.hoisted(() => ({
  delete: vi.fn(),
}));

const accounts = vi.hoisted(() => ({
  resolveGoogleUser: vi.fn(async () => ({
    userId: "user_legacy_owner",
    email: "owner@gmail.com",
    role: "user" as const,
  })),
  isUserDisabled: vi.fn(async () => false),
  isGoogleSubjectDisabled: vi.fn(async () => false),
}));

vi.mock("@/lib/auth-store", () => ({
  sessionIsCurrent: sessions.current,
  revokeSession: sessions.revoke,
  revokeAllSessions: sessions.revokeAll,
  beginSession: sessions.begin,
  limitSharedLogin: sessions.limit,
}));

vi.mock("@/lib/accounts", () => ({
  resolveGoogleUser: accounts.resolveGoogleUser,
  isUserDisabled: accounts.isUserDisabled,
  isGoogleSubjectDisabled: accounts.isGoogleSubjectDisabled,
}));

vi.mock("next-auth", () => ({
  default: () => ({
    auth: authFns.auth,
    signIn: vi.fn(),
    signOut: authFns.signOut,
    handlers: { GET: vi.fn(), POST: vi.fn() },
  }),
}));

vi.mock("next-auth/providers/google", () => ({ default: () => ({}) }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => undefined,
    delete: cookieJar.delete,
  }),
  headers: async () => new Headers({ "x-forwarded-for": "9.9.9.9, 203.0.113.8" }),
}));

import { POST as logout } from "@/app/api/auth/logout/route";
import { googleJwt, googleSession, googleSignIn, readGoogleSession } from "@/lib/google-auth";

const profile = { email: "owner@gmail.com", email_verified: true, sub: "google-subject" };
const account = { provider: "google", providerAccountId: "google-subject" };

beforeEach(() => {
  vi.stubEnv("AUTH_SECRET", "a".repeat(32));
  vi.stubEnv("ADMIN_EMAILS", "");
  sessions.current.mockReset();
  sessions.revoke.mockReset();
  sessions.revokeAll.mockReset();
  sessions.begin.mockReset();
  sessions.limit.mockReset();
  authFns.auth.mockReset();
  authFns.signOut.mockReset();
  cookieJar.delete.mockReset();
  accounts.resolveGoogleUser.mockReset();
  accounts.resolveGoogleUser.mockResolvedValue({
    userId: "user_legacy_owner",
    email: "owner@gmail.com",
    role: "user",
  });
  accounts.isUserDisabled.mockReset();
  accounts.isUserDisabled.mockResolvedValue(false);
  accounts.isGoogleSubjectDisabled.mockReset();
  accounts.isGoogleSubjectDisabled.mockResolvedValue(false);
  sessions.begin.mockResolvedValue({ sessionId: "session-id-123456", sessionVersion: 2 });
  sessions.limit.mockImplementation(async (_key: string, _now: number, check: () => Promise<boolean>) => {
    return (await check()) ? { status: "allowed" } : { status: "rejected" };
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Google sessions", () => {
  it("rate-limits with the viewer address and refuses an unverified email", async () => {
    const allowed = await googleSignIn({ account, profile });
    expect(allowed).toBe(true);
    expect(sessions.limit).toHaveBeenCalledWith("203.0.113.8", expect.any(Number), expect.any(Function));

    sessions.limit.mockResolvedValue({ status: "blocked", retryAfterSeconds: 8 });
    await expect(googleSignIn({ account, profile })).resolves.toBe("/login?error=TooManyAttempts");

    sessions.limit.mockImplementation(async (_key: string, _now: number, check: () => Promise<boolean>) => {
      expect(await check()).toBe(false);
      return { status: "rejected" };
    });
    await expect(
      googleSignIn({ account, profile: { ...profile, email_verified: false } })
    ).resolves.toBe(false);
  });

  it("stores a revocable session for the app user id, not the Google subject", async () => {
    const token = await googleJwt({ token: {} as JWT, account, profile });
    expect(sessions.begin).toHaveBeenCalledWith("user_legacy_owner");
    expect(token).toMatchObject({
      appUserId: "user_legacy_owner",
      email: "owner@gmail.com",
      sessionId: "session-id-123456",
      sessionVersion: 2,
      role: "user",
    });
    expect(token.appUserId).not.toBe("google-subject");

    const session = await googleSession({
      session: { user: { email: "" }, expires: "" } as Session,
      token,
    });
    expect(session).toMatchObject({
      appUserId: "user_legacy_owner",
      sessionId: "session-id-123456",
      sessionVersion: 2,
    });
  });

  it("refuses a disabled Google subject before a session is issued", async () => {
    accounts.isGoogleSubjectDisabled.mockResolvedValue(true);
    await expect(googleSignIn({ account, profile })).resolves.toBe("/login?error=AccountDisabled");
    expect(sessions.begin).not.toHaveBeenCalled();
  });

  it("treats a current session as signed out when the user is disabled", async () => {
    authFns.auth.mockResolvedValue({
      user: { email: "owner@gmail.com" },
      appUserId: "user_legacy_owner",
      emailVerified: true,
      role: "user",
      sessionId: "session-id-123456",
      sessionVersion: 2,
    });
    sessions.current.mockResolvedValue(true);
    accounts.isUserDisabled.mockResolvedValue(true);
    expect(await readGoogleSession()).toBeNull();
    expect(accounts.isUserDisabled).toHaveBeenCalledWith("user_legacy_owner");
  });

  it("hides a Google session after logout revokes it", async () => {
    authFns.auth.mockResolvedValue({
      user: { email: "owner@gmail.com" },
      appUserId: "user_legacy_owner",
      emailVerified: true,
      role: "user",
      sessionId: "session-id-123456",
      sessionVersion: 2,
    });
    sessions.current.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect((await readGoogleSession())?.userId).toBe("user_legacy_owner");
    expect(sessions.current).toHaveBeenCalledWith("user_legacy_owner", "session-id-123456", 2);
    expect(await readGoogleSession()).toBeNull();
  });

  it("logout everywhere bumps the Google user's session version", async () => {
    vi.stubEnv("AUTH_MODE", "google");
    authFns.auth.mockResolvedValue({
      user: { email: "owner@gmail.com" },
      appUserId: "user_legacy_owner",
      emailVerified: true,
      sessionId: "session-id-123456",
      sessionVersion: 2,
    });
    const response = await logout(
      new Request("http://localhost/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ everywhere: true }),
      })
    );
    expect(response.status).toBe(200);
    expect(sessions.revokeAll).toHaveBeenCalledWith("user_legacy_owner");
    expect(sessions.revoke).not.toHaveBeenCalled();
    expect(authFns.signOut).toHaveBeenCalledWith({ redirect: false });
    expect(cookieJar.delete).toHaveBeenCalled();
  });
});
