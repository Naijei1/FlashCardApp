import { NextResponse } from "next/server";
import { isUserDisabled } from "@/lib/accounts";
import { sessionIsCurrent } from "@/lib/auth-store";
import { authMode } from "@/lib/flags";
import { readGoogleAuthState } from "@/lib/google-auth";
import { publicOrigin } from "@/lib/pwa-google-start";
import { HANDOFF_ID, PWA_HANDOFF_COOKIE, depositCanClaim, openHandoffCookie } from "@/lib/pwa-handoff";
import { dynamoPwaAuthStore } from "@/lib/pwa-handoff-db";
import { parseCookieHeader } from "@/lib/pwa-oauth-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function redirect(request: Request, handoff: string, result: "done" | "error") {
  const url = new URL("/login/pwa-return", publicOrigin(request));
  url.searchParams.set("handoff", handoff);
  if (result === "done") url.searchParams.set("done", "1");
  else url.searchParams.set("error", "TryAgain");
  const response = NextResponse.redirect(url, 303);
  response.headers.set("cache-control", "no-store");
  return response;
}

/**
 * The browser that finished Google posts here. If that browser is the installed
 * app, it also holds the handoff secret and can go straight home. The Safari
 * sheet only marks the handoff ready for the app to claim.
 */
export async function POST(request: Request) {
  if (authMode() !== "google") {
    return NextResponse.json({ error: "not found" }, { status: 404, headers: { "cache-control": "no-store" } });
  }
  const form = await request.formData().catch(() => null);
  const handoff = form?.get("handoff");
  const id = typeof handoff === "string" ? handoff : "";
  if (!HANDOFF_ID.test(id)) {
    return NextResponse.json({ error: "not found" }, { status: 400, headers: { "cache-control": "no-store" } });
  }

  const now = Date.now();
  try {
    const state = await readGoogleAuthState();
    const usable =
      !!state &&
      (await sessionIsCurrent(state.userId, state.sessionId, state.sessionVersion, now)) &&
      !(await isUserDisabled(state.userId));
    if (!usable || !state) return redirect(request, id, "error");

    const record = await dynamoPwaAuthStore.readHandoff(id);
    if (!record || record.expiresAt <= now || record.status === "claimed") return redirect(request, id, "error");
    if (record.status === "pending") {
      const ready = await dynamoPwaAuthStore.markReady(
        id,
        {
          appUserId: state.userId,
          email: state.email,
          sessionId: state.sessionId,
          sessionVersion: state.sessionVersion,
        },
        now
      );
      if (!ready) return redirect(request, id, "error");
    }

    const cookie = openHandoffCookie(parseCookieHeader(request.headers.get("cookie")).get(PWA_HANDOFF_COOKIE));
    if (depositCanClaim(cookie, id, record.secretHash)) {
      await dynamoPwaAuthStore.markClaimed(id, now);
      const home = NextResponse.redirect(new URL("/", publicOrigin(request)), 303);
      home.headers.set("cache-control", "no-store");
      return home;
    }
    return redirect(request, id, "done");
  } catch (error) {
    console.error("PWA handoff deposit failed", error instanceof Error ? error.name : "unknown");
    return redirect(request, id, "error");
  }
}
