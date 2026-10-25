import { NextResponse } from "next/server";
import { isUserDisabled } from "@/lib/accounts";
import { dynamoLoginStore, hashLoginKey, limitSharedLogin, sessionIsCurrent } from "@/lib/auth-store";
import { authMode } from "@/lib/flags";
import { googleAuthSecret } from "@/lib/google-auth";
import { authCookiesAreSecure, encodeAppSession, sessionCookieOptions } from "@/lib/google-session-cookie";
import { clientAddressKey, retryAfterBlock } from "@/lib/login-limit";
import {
  PWA_HANDOFF_COOKIE,
  handoffSecretsMatch,
  openHandoffCookie,
  validHandoffSession,
} from "@/lib/pwa-handoff";
import { dynamoPwaAuthStore } from "@/lib/pwa-handoff-db";
import { parseCookieHeader } from "@/lib/pwa-oauth-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStore(body: unknown, status: number, extra?: HeadersInit) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store", ...extra } });
}

/**
 * The Home Screen app trades its handoff cookie for an Auth.js session cookie
 * in its own jar. The Safari sheet cannot call this: it never received the cookie.
 */
export async function POST(request: Request) {
  if (authMode() !== "google") return noStore({ error: "not found" }, 404);
  const now = Date.now();
  const rawKey = `pwa-claim:${clientAddressKey(request.headers)}`;
  try {
    const blocked = retryAfterBlock(await dynamoLoginStore.get(hashLoginKey(rawKey)), now);
    if (blocked) return noStore({ error: "Too many attempts. Wait a moment and try again." }, 429, { "retry-after": String(blocked) });

    const cookie = openHandoffCookie(parseCookieHeader(request.headers.get("cookie")).get(PWA_HANDOFF_COOKIE));
    const record = cookie ? await dynamoPwaAuthStore.readHandoff(cookie.id) : null;
    const secretOk = !!cookie && !!record && record.expiresAt > now && handoffSecretsMatch(cookie.secret, record.secretHash);
    if (!secretOk || !record) {
      const result = await limitSharedLogin(rawKey, now, async () => false);
      if (result.status === "blocked") {
        return noStore({ error: "Too many attempts. Wait a moment and try again." }, 429, {
          "retry-after": String(result.retryAfterSeconds),
        });
      }
      return noStore({ error: "That sign-in expired. Try Google again." }, 401);
    }
    if (record.status !== "ready") return noStore({ error: "pending" }, 409);
    const session = {
      appUserId: record.appUserId,
      email: record.email,
      sessionId: record.sessionId,
      sessionVersion: record.sessionVersion,
    };
    if (!validHandoffSession(session)) return noStore({ error: "That sign-in expired. Try Google again." }, 401);
    const current = await sessionIsCurrent(session.appUserId, session.sessionId, session.sessionVersion, now);
    if (!current || (await isUserDisabled(session.appUserId))) {
      return noStore({ error: "That sign-in expired. Try Google again." }, 401);
    }
    const claimed = await dynamoPwaAuthStore.markClaimed(record.id, now);
    if (!claimed) return noStore({ error: "That sign-in expired. Try Google again." }, 401);

    const secure = authCookiesAreSecure(request);
    const minted = await encodeAppSession(googleAuthSecret(), session, secure);
    const response = noStore({ ok: true }, 200);
    response.cookies.set(minted.name, minted.value, sessionCookieOptions(secure));
    response.cookies.set(PWA_HANDOFF_COOKIE, "", { ...sessionCookieOptions(secure), maxAge: 0 });
    return response;
  } catch (error) {
    console.error("PWA handoff claim failed", error instanceof Error ? error.name : "unknown");
    return noStore({ error: "try again shortly" }, 503);
  }
}
