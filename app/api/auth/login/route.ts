import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  SESSION_COOKIE,
  checkPassword,
  sessionCookieOptions,
  signSession,
} from "@/lib/auth";

type AttemptState = { failures: number; windowStartedAt: number; blockedUntil: number };
const globalForLogin = globalThis as unknown as { __loginAttempts?: Map<string, AttemptState> };
const attempts = (globalForLogin.__loginAttempts ??= new Map());
const WINDOW_MS = 15 * 60_000;
const FREE_ATTEMPTS = 5;
const MAX_BLOCK_SECONDS = 60;

function clientKey(request: Request): string {
  // CloudFront appends the viewer address to any incoming X-Forwarded-For
  // value, so the last entry cannot be replaced by a caller-supplied prefix.
  const forwarded = request.headers
    .get("x-forwarded-for")
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .at(-1);
  return (forwarded || request.headers.get("x-real-ip") || "unknown").slice(0, 128);
}

function currentAttempt(key: string, now: number): AttemptState {
  if (attempts.size > 5_000) {
    for (const [candidate, state] of attempts) {
      if (now - state.windowStartedAt >= WINDOW_MS) attempts.delete(candidate);
    }
    if (attempts.size > 5_000) attempts.delete(attempts.keys().next().value as string);
  }
  const existing = attempts.get(key);
  if (!existing || now - existing.windowStartedAt >= WINDOW_MS) {
    const fresh = { failures: 0, windowStartedAt: now, blockedUntil: 0 };
    attempts.set(key, fresh);
    return fresh;
  }
  return existing;
}

function blockedResponse(retryAfter: number) {
  return NextResponse.json(
    { error: "too many attempts; try again shortly" },
    { status: 429, headers: { "Retry-After": String(retryAfter), "Cache-Control": "no-store" } }
  );
}

export async function POST(request: Request) {
  const now = Date.now();
  const key = clientKey(request);
  const attempt = currentAttempt(key, now);
  if (attempt.blockedUntil > now) {
    return blockedResponse(Math.max(1, Math.ceil((attempt.blockedUntil - now) / 1000)));
  }
  const body = await request.json().catch(() => null);
  const password = typeof body?.password === "string" ? body.password : "";
  if (!checkPassword(password)) {
    attempt.failures += 1;
    if (attempt.failures > FREE_ATTEMPTS) {
      const seconds = Math.min(2 ** (attempt.failures - FREE_ATTEMPTS), MAX_BLOCK_SECONDS);
      attempt.blockedUntil = now + seconds * 1000;
    }
    return NextResponse.json(
      { error: "wrong password" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }
  attempts.delete(key);
  const store = await cookies();
  store.set(SESSION_COOKIE, await signSession(), sessionCookieOptions);
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
