import { beforeEach, describe, expect, it, vi } from "vitest";

const handlers = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));

const restore = vi.hoisted(() => vi.fn());

vi.mock("next-auth", () => ({
  default: () => ({
    auth: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
    handlers: { GET: handlers.get, POST: handlers.post },
  }),
}));

vi.mock("next-auth/providers/google", () => ({ default: () => ({}) }));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, delete: vi.fn() }),
}));

vi.mock("@/lib/auth-store", () => ({
  sessionIsCurrent: vi.fn(),
  beginSession: vi.fn(),
  limitSharedLogin: vi.fn(),
}));

vi.mock("@/lib/accounts", () => ({
  resolveGoogleUser: vi.fn(),
  isUserDisabled: vi.fn(),
  isGoogleSubjectDisabled: vi.fn(),
}));

vi.mock("@/lib/pwa-oauth-restore", () => ({
  restorePwaOAuthRequest: restore,
}));

import { handleGoogleAuth } from "@/lib/google-auth";

const handoffId = "abcdefghijklmnopqrstuv";

beforeEach(() => {
  handlers.get.mockReset();
  restore.mockReset();
});

describe("Google callback handoff", () => {
  it("rewrites an OAuth error onto the handoff page and leaves other redirects alone", async () => {
    const request = new Request("https://flashcards.example/api/auth/callback/google?state=abc");
    const restored = new Request(request.url, { headers: { cookie: "authjs.pkce.code_verifier=verifier" } });
    restore.mockResolvedValue({ request: restored, handoffId });
    handlers.get.mockResolvedValue(Response.redirect("https://flashcards.example/login?error=OAuthCallback"));

    const response = await handleGoogleAuth("GET", request);
    expect(handlers.get).toHaveBeenCalledWith(restored);
    expect(response.headers.get("location")).toBe(
      `https://flashcards.example/login/pwa-return?handoff=${handoffId}&error=OAuthCallback`
    );

    handlers.get.mockResolvedValue(Response.redirect("https://flashcards.example/login/pwa-return?handoff=" + handoffId));
    const success = await handleGoogleAuth("GET", request);
    expect(success.headers.get("location")).toBe(`https://flashcards.example/login/pwa-return?handoff=${handoffId}`);
  });

  it("keeps the Auth.js response when this callback is not a handoff", async () => {
    const request = new Request("https://flashcards.example/api/auth/callback/google?state=abc");
    restore.mockResolvedValue({ request, handoffId: null });
    handlers.get.mockResolvedValue(Response.redirect("https://flashcards.example/login?error=OAuthCallback"));
    const response = await handleGoogleAuth("GET", request);
    expect(response.headers.get("location")).toBe("https://flashcards.example/login?error=OAuthCallback");
  });
});
