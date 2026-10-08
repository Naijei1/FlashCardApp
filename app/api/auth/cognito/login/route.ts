import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { authMode } from "@/lib/auth";
import { cognitoAuthorizeUrl, createOAuthState, createPkcePair } from "@/lib/cognito";
import { rateLimit } from "@/lib/rate-limit";

const TEN_MINUTES = 10 * 60;

function clientKey(request: Request): string {
  const forwarded = request.headers
    .get("x-forwarded-for")
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .at(-1);
  return (forwarded || request.headers.get("x-real-ip") || "unknown").slice(0, 128);
}

/** Starts Cognito hosted login. Inactive unless AUTH_MODE=cognito. */
export async function GET(request: Request) {
  if (authMode() !== "cognito") return NextResponse.json({ error: "not found" }, { status: 404 });
  const limit = rateLimit(`cognito-login:${clientKey(request)}`, 20, 15 * 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "too many login attempts" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }
  const { verifier, challenge } = createPkcePair();
  const state = createOAuthState();
  const store = await cookies();
  const options = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: TEN_MINUTES,
  };
  store.set("cognito_pkce", verifier, options);
  store.set("cognito_state", state, options);
  return NextResponse.redirect(cognitoAuthorizeUrl(state, challenge));
}
