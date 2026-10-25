import { readFileSync } from "node:fs";
import { Auth } from "@auth/core";
import { decode } from "@auth/core/jwt";
import Google from "@auth/core/providers/google";
import { afterEach, describe, expect, it } from "vitest";
import { encodeAppSession, authSessionCookieName } from "@/lib/google-session-cookie";
import { roleForVerifiedEmail } from "@/lib/multi-user-model";
import { isIosHomeScreenApp } from "@/lib/ios-standalone";
import { retryAfterBlock } from "@/lib/login-limit";
import {
  HANDOFF_CREATE_LIMIT,
  HANDOFF_CREATE_WINDOW_MS,
  depositCanClaim,
  handoffSecretsMatch,
  hashHandoffSecret,
  hashOAuthState,
  newHandoffRecord,
  nextCreateWindow,
  openHandoffCookie,
  reserveHandoffCreate,
  sealHandoffCookie,
  type CreateWindow,
  type HandoffRecord,
  type OAuthBundle,
  type PwaAuthStore,
} from "@/lib/pwa-handoff";
import { startGoogleOAuth } from "@/lib/pwa-google-start";
import { restorePwaOAuthRequest } from "@/lib/pwa-oauth-restore";
import {
  applySetCookies,
  isGoogleCallbackPath,
  oauthStateFromLocation,
  overlayOAuthCookies,
  readSetCookie,
  rewritePwaAuthError,
} from "@/lib/pwa-oauth-state";

const SECRET = "test-secret-test-secret-test-secret-xx";

function memoryStore(): PwaAuthStore & { handoffs: Map<string, HandoffRecord>; oauth: Map<string, OAuthBundle & { consumed?: boolean }> } {
  const handoffs = new Map<string, HandoffRecord>();
  const oauth = new Map<string, OAuthBundle & { consumed?: boolean }>();
  const windows = new Map<string, CreateWindow>();
  return {
    handoffs,
    oauth,
    async saveHandoff(record) {
      if (handoffs.has(record.id)) throw new Error("exists");
      handoffs.set(record.id, { ...record });
    },
    async readHandoff(id) {
      const record = handoffs.get(id);
      return record ? { ...record } : null;
    },
    async markReady(id, session, now) {
      const record = handoffs.get(id);
      if (!record || record.status !== "pending" || record.expiresAt <= now) return false;
      handoffs.set(id, { ...record, ...session, status: "ready" });
      return true;
    },
    async markClaimed(id, now) {
      const record = handoffs.get(id);
      if (!record || record.status !== "ready" || record.expiresAt <= now) return false;
      handoffs.set(id, { ...record, status: "claimed" });
      return true;
    },
    async saveOAuth(bundle) {
      oauth.set(bundle.stateHash, { ...bundle, cookies: bundle.cookies.map((cookie) => ({ ...cookie })) });
    },
    async takeOAuth(stateHash, now) {
      const bundle = oauth.get(stateHash);
      if (!bundle || bundle.consumed || bundle.expiresAt <= now) return null;
      bundle.consumed = true;
      return { stateHash: bundle.stateHash, handoffId: bundle.handoffId, expiresAt: bundle.expiresAt, cookies: bundle.cookies };
    },
    async readCreateWindow(key) {
      const window = windows.get(key);
      return window ? { ...window } : null;
    },
    async saveCreateWindow(key, next, expected) {
      const current = windows.get(key) ?? null;
      if (expected === "absent") {
        if (current) return false;
      } else if (!current || current.count !== expected.count || current.windowStartedAt !== expected.windowStartedAt) {
        return false;
      }
      windows.set(key, { ...next });
      return true;
    },
  };
}

afterEach(() => {
  delete process.env.ADMIN_EMAILS;
});

describe("iOS Home Screen detection", () => {
  it("is true only for the legacy standalone flag", () => {
    expect(isIosHomeScreenApp({ standalone: true })).toBe(true);
    expect(isIosHomeScreenApp({ standalone: false })).toBe(false);
    expect(isIosHomeScreenApp({})).toBe(false);
  });
});

describe("PWA OAuth cookie restore", () => {
  it("decodes Auth.js set-cookie values and drops cleared cookies", () => {
    const jar = new Map<string, string>();
    applySetCookies(jar, [
      "__Host-authjs.csrf-token=abc%7Cdef; Path=/; HttpOnly; Secure",
      "__Secure-authjs.state=; Path=/; Max-Age=0",
      "__Secure-authjs.pkce.code_verifier=verifier; Path=/; HttpOnly",
      "session=ignored",
    ]);
    expect([...jar]).toEqual([
      ["__Host-authjs.csrf-token", "abc|def"],
      ["__Secure-authjs.pkce.code_verifier", "verifier"],
    ]);
    expect(readSetCookie("not a cookie")).toBeNull();
  });

  it("puts saved flow cookies ahead of a stale browser copy", () => {
    const header = overlayOAuthCookies("__Secure-authjs.state=stale; theme=dark", [
      { name: "__Secure-authjs.state", value: "fresh" },
      { name: "__Secure-authjs.pkce.code_verifier", value: "verifier" },
      { name: "session", value: "nope" },
    ]);
    expect(header.startsWith("__Secure-authjs.state=fresh")).toBe(true);
    expect(header).toContain("__Secure-authjs.pkce.code_verifier=verifier");
    expect(header).toContain("theme=dark");
    expect(header).not.toContain("session=");
    expect(header).not.toContain("stale");
  });

  it("reads state from the Google redirect and ignores other URLs", () => {
    expect(oauthStateFromLocation("https://accounts.google.com/o/oauth2/v2/auth?state=abcdefghijklmnopqrstuvwxyz")).toBe(
      "abcdefghijklmnopqrstuvwxyz"
    );
    expect(oauthStateFromLocation("https://accounts.google.com/o/oauth2/v2/auth")).toBeNull();
    expect(isGoogleCallbackPath("/api/auth/callback/google")).toBe(true);
    expect(isGoogleCallbackPath("/api/auth/signin/google")).toBe(false);
  });

  it("restores the saved jar once and sends handoff failures away from the normal login page", async () => {
    const store = memoryStore();
    const { record } = newHandoffRecord(1_700_000_000_000);
    const state = "state-value-that-is-long-enough";
    await store.saveOAuth({
      stateHash: hashOAuthState(state),
      handoffId: record.id,
      cookies: [
        { name: "__Secure-authjs.pkce.code_verifier", value: "verifier" },
        { name: "__Secure-authjs.state", value: "fresh" },
      ],
      expiresAt: 1_700_000_000_000 + 60_000,
    });
    const request = new Request(`https://flashcards.example/api/auth/callback/google?state=${state}`, {
      headers: { cookie: "__Secure-authjs.state=stale" },
    });
    const restored = await restorePwaOAuthRequest(request, 1_700_000_000_000, store);
    expect(restored.handoffId).toBe(record.id);
    expect(restored.request.headers.get("cookie")).toContain("__Secure-authjs.pkce.code_verifier=verifier");
    expect(restored.request.headers.get("cookie")).toContain("__Secure-authjs.state=fresh");
    expect(restored.request.headers.get("cookie")).not.toContain("stale");
    await expect(restorePwaOAuthRequest(request, 1_700_000_000_000, store)).resolves.toMatchObject({ handoffId: null });

    const rewritten = rewritePwaAuthError(
      Response.redirect(`https://flashcards.example/login?error=OAuthCallback`),
      record.id
    );
    expect(rewritten.headers.get("location")).toBe(
      `https://flashcards.example/login/pwa-return?handoff=${record.id}&error=OAuthCallback`
    );
    const success = rewritePwaAuthError(Response.redirect("https://flashcards.example/"), record.id);
    expect(success.headers.get("location")).toBe("https://flashcards.example/");
  });
});

describe("PWA handoff", () => {
  it("keeps the secret out of the cookie parser's id and allows one claim", async () => {
    const store = memoryStore();
    const now = 1_700_000_000_000;
    const { record, secret } = newHandoffRecord(now);
    await store.saveHandoff(record);
    const cookie = openHandoffCookie(sealHandoffCookie(record.id, secret));
    expect(cookie).toEqual({ id: record.id, secret });
    expect(handoffSecretsMatch(secret, record.secretHash)).toBe(true);
    expect(handoffSecretsMatch("other-secret-other-secret-other-secret-ot", record.secretHash)).toBe(false);
    expect(depositCanClaim(cookie, record.id, record.secretHash)).toBe(true);
    expect(depositCanClaim(null, record.id, record.secretHash)).toBe(false);
    expect(await store.markReady(record.id, {
      appUserId: "user_legacy_owner",
      email: "owner@gmail.com",
      sessionId: "session-id-123456",
      sessionVersion: 2,
    }, now)).toBe(true);
    expect(await store.markReady(record.id, {
      appUserId: "user_legacy_owner",
      email: "owner@gmail.com",
      sessionId: "session-id-123456",
      sessionVersion: 2,
    }, now)).toBe(false);
    expect(await store.markClaimed(record.id, now)).toBe(true);
    expect(await store.markClaimed(record.id, now)).toBe(false);
    expect(openHandoffCookie("short.secret")).toBeNull();
    expect(hashHandoffSecret(secret)).toBe(record.secretHash);
  });

  it("blocks handoff creation after the window budget and resets later", async () => {
    const store = memoryStore();
    const now = 1_700_000_000_000;
    for (let i = 0; i < HANDOFF_CREATE_LIMIT; i++) {
      expect(await reserveHandoffCreate(store, "a".repeat(64), now + i)).toBe(true);
    }
    expect(await reserveHandoffCreate(store, "a".repeat(64), now + 30)).toBe(false);
    expect(nextCreateWindow(await store.readCreateWindow("a".repeat(64)), now + 30)).toBe("blocked");
    expect(await reserveHandoffCreate(store, "a".repeat(64), now + HANDOFF_CREATE_WINDOW_MS + 1)).toBe(true);
  });

  it("reports an active claim block", () => {
    expect(retryAfterBlock(null, 1_000)).toBeNull();
    expect(retryAfterBlock({ failures: 6, windowStartedAt: 0, blockedUntil: 5_000 }, 1_500)).toBe(4);
    expect(retryAfterBlock({ failures: 6, windowStartedAt: 0, blockedUntil: 5_000 }, 20 * 60_000)).toBeNull();
  });
});

describe("Auth.js session handoff cookie", () => {
  it("round-trips the claims readGoogleSession expects", async () => {
    process.env.ADMIN_EMAILS = "admin@gmail.com";
    const minted = await encodeAppSession(
      SECRET,
      {
        appUserId: "user_legacy_owner",
        email: "admin@gmail.com",
        sessionId: "session-id-123456",
        sessionVersion: 4,
      },
      true
    );
    expect(minted.name).toBe(authSessionCookieName(true));
    const token = await decode({ token: minted.value, secret: SECRET, salt: minted.name });
    expect(token).toMatchObject({
      appUserId: "user_legacy_owner",
      email: "admin@gmail.com",
      emailVerified: true,
      sessionId: "session-id-123456",
      sessionVersion: 4,
      role: "admin",
    });
    expect(roleForVerifiedEmail("admin@gmail.com", true)).toBe("admin");
  });
});

describe("Google sign-in start", () => {
  it("captures state and PKCE cookies from Auth.js", async () => {
    const errors: unknown[] = [];
    const config = {
      secret: SECRET,
      trustHost: true,
      basePath: "/api/auth",
      logger: {
        error(error: unknown) {
          errors.push(error);
        },
        warn() {},
        debug() {},
      },
      providers: [
        {
          id: "google",
          name: "Google",
          type: "oauth" as const,
          checks: ["pkce", "state"] as ("pkce" | "state")[],
          clientId: "client-id",
          clientSecret: "client-secret",
          authorization: "https://accounts.google.com/o/oauth2/v2/auth",
          token: "https://oauth2.googleapis.com/token",
          userinfo: "https://openidconnect.googleapis.com/v1/userinfo",
        },
      ],
    };
    const started = await startGoogleOAuth({
      origin: "https://flashcards.example",
      callbackPath: "/login/pwa-return?handoff=abcdefghijklmnopqrstuv",
      dispatch: (request) => Auth(request, config),
    });
    expect(started.location).toContain("https://accounts.google.com/o/oauth2/v2/auth");
    expect(started.state.length).toBeGreaterThan(20);
    expect(started.cookies.some((cookie) => cookie.name.includes("pkce.code_verifier"))).toBe(true);
    expect(started.cookies.some((cookie) => cookie.name.endsWith("authjs.state"))).toBe(true);
    expect(started.location).toContain(encodeURIComponent(started.state).slice(0, 20));

    const describeError = (error: unknown) => {
      const cause = (error as { cause?: unknown }).cause;
      return `${error instanceof Error ? error.message : String(error)} | ${cause instanceof Error ? cause.message : String(cause ?? "")}`;
    };
    const missing = await Auth(
      new Request(`https://flashcards.example/api/auth/callback/google?state=${encodeURIComponent(started.state)}&code=code`),
      config
    );
    const missingErrors = errors.splice(0).map(describeError);
    const restoredCookies = started.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
    const restored = await Auth(
      new Request(
        `https://flashcards.example/api/auth/callback/google?state=${encodeURIComponent(started.state)}&code=code`,
        { headers: { cookie: restoredCookies } }
      ),
      config
    );
    const restoredErrors = errors.map(describeError);
    expect(missing.status).toBeGreaterThanOrEqual(300);
    expect(missing.headers.get("location")).toContain("error=");
    expect(missingErrors.some((text) => text.includes("cookie was missing"))).toBe(true);
    expect(restored.status).toBeGreaterThanOrEqual(300);
    expect(restoredErrors.some((text) => text.includes("cookie was missing"))).toBe(false);
  });

  it("asks Google to echo state for the production provider", async () => {
    expect(readFileSync("lib/google-auth.ts", "utf8")).toContain('checks: ["pkce", "state"]');
    const discovery = {
      issuer: "https://accounts.google.com",
      authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
      token_endpoint: "https://oauth2.googleapis.com/token",
      userinfo_endpoint: "https://openidconnect.googleapis.com/v1/userinfo",
      jwks_uri: "https://www.googleapis.com/oauth2/v3/certs",
      response_types_supported: ["code"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"],
      code_challenge_methods_supported: ["S256"],
    };
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes("openid-configuration")) {
        return new Response(JSON.stringify(discovery), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("unexpected", { status: 500 });
    }) as typeof fetch;
    try {
      const started = await startGoogleOAuth({
        origin: "https://flashcards.example",
        callbackPath: "/login/pwa-return?handoff=abcdefghijklmnopqrstuv",
        dispatch: (request) =>
          Auth(request, {
            secret: SECRET,
            trustHost: true,
            basePath: "/api/auth",
            providers: [Google({ clientId: "client", clientSecret: "secret", checks: ["pkce", "state"] })],
          }),
      });
      const redirect = new URL(started.location);
      expect(redirect.searchParams.get("state")).toBeTruthy();
      expect(redirect.searchParams.get("code_challenge")).toBeTruthy();
      expect(redirect.searchParams.get("redirect_uri")).toBe("https://flashcards.example/api/auth/callback/google");
    } finally {
      globalThis.fetch = original;
    }
  });
});
