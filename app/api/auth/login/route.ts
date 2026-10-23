import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { beginSession, limitSharedLogin } from "@/lib/auth-store";
import {
  SESSION_COOKIE,
  checkPassword,
  sessionCookieOptions,
  signSession,
} from "@/lib/auth";
import { SHARED_USER_ID } from "@/lib/constants";

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

function blockedResponse(retryAfter: number) {
  return NextResponse.json(
    { error: "too many attempts; try again shortly" },
    { status: 429, headers: { "Retry-After": String(retryAfter), "Cache-Control": "no-store" } }
  );
}

export async function POST(request: Request) {
  const now = Date.now();
  const key = clientKey(request);
  let result;
  try {
    result = await limitSharedLogin(key, now, async () => {
      const body = await request.json().catch(() => null);
      const password = typeof body?.password === "string" ? body.password : "";
      return checkPassword(password);
    });
  } catch (error) {
    console.error("Login rate limit failed", error instanceof Error ? error.name : "unknown");
    return NextResponse.json(
      { error: "try again shortly" },
      { status: 503, headers: { "Retry-After": "2", "Cache-Control": "no-store" } }
    );
  }
  if (result.status === "blocked") return blockedResponse(result.retryAfterSeconds);
  if (result.status === "rejected") {
    return NextResponse.json(
      { error: "wrong password" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }
  try {
    const issued = await beginSession(SHARED_USER_ID, now);
    const store = await cookies();
    store.set(
      SESSION_COOKIE,
      await signSession({
        userId: SHARED_USER_ID,
        sessionId: issued.sessionId,
        sessionVersion: issued.sessionVersion,
      }),
      sessionCookieOptions
    );
  } catch (error) {
    console.error("Login session create failed", error instanceof Error ? error.name : "unknown");
    return NextResponse.json(
      { error: "try again shortly" },
      { status: 503, headers: { "Retry-After": "2", "Cache-Control": "no-store" } }
    );
  }
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
