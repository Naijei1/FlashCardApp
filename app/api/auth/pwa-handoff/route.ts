import { NextResponse } from "next/server";
import { hashLoginKey } from "@/lib/auth-store";
import { authMode } from "@/lib/flags";
import { clientAddressKey } from "@/lib/login-limit";
import { authCookiesAreSecure } from "@/lib/google-session-cookie";
import {
  HANDOFF_TTL_MS,
  PWA_HANDOFF_COOKIE,
  handoffIsCurrent,
  handoffSecretsMatch,
  newHandoffRecord,
  openHandoffCookie,
  reserveHandoffCreate,
  sealHandoffCookie,
} from "@/lib/pwa-handoff";
import { dynamoPwaAuthStore } from "@/lib/pwa-handoff-db";
import { parseCookieHeader } from "@/lib/pwa-oauth-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

function handoffCookieOptions(request: Request) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: authCookiesAreSecure(request),
    maxAge: Math.ceil(HANDOFF_TTL_MS / 1000),
  };
}

/** The installed app asks whether the Safari sheet has finished. */
export async function GET(request: Request) {
  if (authMode() !== "google") return noStore({ error: "not found" }, 404);
  const cookie = openHandoffCookie(parseCookieHeader(request.headers.get("cookie")).get(PWA_HANDOFF_COOKIE));
  if (!cookie) return noStore({ error: "not found" }, 404);
  try {
    const record = await dynamoPwaAuthStore.readHandoff(cookie.id);
    if (!record || !handoffIsCurrent(record, Date.now()) || !handoffSecretsMatch(cookie.secret, record.secretHash)) {
      return noStore({ error: "not found" }, 404);
    }
    return noStore({ id: record.id, confirmCode: record.confirmCode, status: record.status });
  } catch (error) {
    console.error("PWA handoff status failed", error instanceof Error ? error.name : "unknown");
    return noStore({ error: "try again shortly" }, 503);
  }
}

/** Starts a handoff owned by this browser. The secret stays in an HttpOnly cookie. */
export async function POST(request: Request) {
  if (authMode() !== "google") return noStore({ error: "not found" }, 404);
  const now = Date.now();
  try {
    const allowed = await reserveHandoffCreate(
      dynamoPwaAuthStore,
      hashLoginKey(`pwa-create:${clientAddressKey(request.headers)}`),
      now
    );
    if (!allowed) {
      return NextResponse.json(
        { error: "Too many attempts. Wait a moment and try again." },
        { status: 429, headers: { "cache-control": "no-store", "retry-after": "60" } }
      );
    }
    const { record, secret } = newHandoffRecord(now);
    await dynamoPwaAuthStore.saveHandoff(record);
    const response = noStore({ id: record.id, confirmCode: record.confirmCode, expiresAt: record.expiresAt });
    response.cookies.set(PWA_HANDOFF_COOKIE, sealHandoffCookie(record.id, secret), handoffCookieOptions(request));
    return response;
  } catch (error) {
    console.error("PWA handoff create failed", error instanceof Error ? error.name : "unknown");
    return noStore({ error: "try again shortly" }, 503);
  }
}
