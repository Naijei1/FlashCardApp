import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { revokeAllSessions, revokeSession } from "@/lib/auth-store";
import { readSessionClaims, SESSION_COOKIE } from "@/lib/auth";
import { authMode } from "@/lib/flags";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const everywhere = !!body && body.everywhere === true;
  if (authMode() === "google") {
    const { readGoogleAuthState, signOutGoogle } = await import("@/lib/google-auth");
    const google = await readGoogleAuthState();
    if (google) {
      if (everywhere) await revokeAllSessions(google.userId);
      else await revokeSession(google.userId, google.sessionId);
    }
    await signOutGoogle();
  }
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  const claims = token ? await readSessionClaims(token) : null;
  if (claims) {
    if (everywhere) await revokeAllSessions(claims.userId);
    else await revokeSession(claims.userId, claims.sessionId);
  }
  store.delete(SESSION_COOKIE);
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
