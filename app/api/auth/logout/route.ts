import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { revokeAllSessions, revokeSession } from "@/lib/auth-store";
import { readSessionClaims, SESSION_COOKIE } from "@/lib/auth";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const everywhere = !!body && body.everywhere === true;
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
