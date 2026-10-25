import { NextRequest, NextResponse } from "next/server";
import { hashLoginKey } from "@/lib/auth-store";
import { authMode } from "@/lib/flags";
import { handleGoogleAuth } from "@/lib/google-auth";
import { clientAddressKey } from "@/lib/login-limit";
import { startGoogleOAuth, publicOrigin } from "@/lib/pwa-google-start";
import {
  HANDOFF_ID,
  OAUTH_STATE_TTL_MS,
  handoffIsCurrent,
  hashOAuthState,
  reserveHandoffCreate,
} from "@/lib/pwa-handoff";
import { dynamoPwaAuthStore } from "@/lib/pwa-handoff-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(status: number, message: string, extra?: HeadersInit) {
  return new Response(message, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...extra },
  });
}

function cookieOptions(name: string) {
  const secure = name.startsWith("__Host-") || name.startsWith("__Secure-");
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure,
    maxAge: 60 * 15,
  };
}

/**
 * Starts Google inside the window iOS opened (Safari or the installed app) and
 * remembers the PKCE cookies by the OAuth `state` value.
 */
export async function GET(request: Request) {
  if (authMode() !== "google") return text(404, "Not found");
  const handoff = new URL(request.url).searchParams.get("handoff") ?? "";
  if (!HANDOFF_ID.test(handoff)) return text(400, "This sign-in link is not valid. Close this window and try again from the app.");

  const now = Date.now();
  try {
    const allowed = await reserveHandoffCreate(
      dynamoPwaAuthStore,
      hashLoginKey(`pwa-start:${clientAddressKey(request.headers)}`),
      now
    );
    if (!allowed) return text(429, "Too many attempts. Wait a moment and try again.", { "retry-after": "60" });

    const record = await dynamoPwaAuthStore.readHandoff(handoff);
    if (!record || !handoffIsCurrent(record, now) || record.status !== "pending") {
      return text(400, "This sign-in expired. Close this window and try again from the app.");
    }

    const started = await startGoogleOAuth({
      origin: publicOrigin(request),
      callbackPath: `/login/pwa-return?handoff=${handoff}`,
      dispatch: (authRequest) => handleGoogleAuth(authRequest.method === "POST" ? "POST" : "GET", new NextRequest(authRequest)),
    });
    await dynamoPwaAuthStore.saveOAuth({
      stateHash: hashOAuthState(started.state),
      handoffId: handoff,
      cookies: started.cookies,
      expiresAt: now + OAUTH_STATE_TTL_MS,
    });

    const response = NextResponse.redirect(started.location, 302);
    response.headers.set("cache-control", "no-store");
    for (const cookie of started.cookies) {
      response.cookies.set(cookie.name, cookie.value, cookieOptions(cookie.name));
    }
    return response;
  } catch (error) {
    console.error("PWA Google start failed", error instanceof Error ? error.name : "unknown");
    return text(503, "Could not start Google sign-in. Close this window and try again.");
  }
}
