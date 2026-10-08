import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, authMode, sessionCookieOptions, verifyCognitoIdToken } from "@/lib/auth";
import { exchangeCognitoCode } from "@/lib/cognito";

/** Completes Cognito auth-code + PKCE login. Inactive unless AUTH_MODE=cognito. */
export async function GET(request: Request) {
  if (authMode() !== "cognito") return NextResponse.json({ error: "not found" }, { status: 404 });
  const url = new URL(request.url);
  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const store = await cookies();
  const expectedState = store.get("cognito_state")?.value;
  const verifier = store.get("cognito_pkce")?.value;
  store.delete("cognito_state");
  store.delete("cognito_pkce");
  if (!code || !verifier || !state || state !== expectedState) {
    return NextResponse.json({ error: "invalid login response" }, { status: 400 });
  }
  const idToken = await exchangeCognitoCode(code, verifier);
  const verified = await verifyCognitoIdToken(idToken);
  if (!verified) return NextResponse.json({ error: "invalid identity token" }, { status: 401 });
  store.set(SESSION_COOKIE, idToken, {
    ...sessionCookieOptions,
    maxAge: Math.max(1, verified.expiresAt - Math.floor(Date.now() / 1000)),
  });
  return NextResponse.redirect(new URL("/", request.url));
}
