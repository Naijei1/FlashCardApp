import { applySetCookies, oauthStateFromLocation, serializeCookieHeader } from "./pwa-oauth-state";
import type { OAuthCookie } from "./pwa-handoff";

export function publicOrigin(request: Request): string {
  const url = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || url.host;
  if (proto && host) return `${proto}://${host}`;
  return url.origin;
}

export type GoogleOAuthStart = {
  location: string;
  state: string;
  cookies: OAuthCookie[];
};

/**
 * Runs the Auth.js CSRF and Google sign-in actions in-process and keeps every
 * Set-Cookie. iOS may drop those cookies when it moves the Google redirect into
 * Safari View Controller; the callback restores this jar from the `state` value
 * Google echoes.
 */
export async function startGoogleOAuth(args: {
  origin: string;
  callbackPath: string;
  dispatch: (request: Request) => Promise<Response>;
}): Promise<GoogleOAuthStart> {
  const origin = args.origin.replace(/\/$/, "");
  const csrfResponse = await args.dispatch(
    new Request(new URL("/api/auth/csrf", origin), { method: "GET", redirect: "manual" })
  );
  if (!csrfResponse.ok) throw new Error("Google sign-in could not start");
  const csrf = (await csrfResponse.json()) as { csrfToken?: unknown };
  if (typeof csrf.csrfToken !== "string" || !csrf.csrfToken) throw new Error("Google sign-in could not start");

  const jar = new Map<string, string>();
  applySetCookies(jar, csrfResponse.headers.getSetCookie());
  const signInResponse = await args.dispatch(
    new Request(new URL("/api/auth/signin/google", origin), {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: serializeCookieHeader(jar),
        "x-auth-return-redirect": "1",
        origin,
      },
      body: new URLSearchParams({ csrfToken: csrf.csrfToken, callbackUrl: args.callbackPath }),
    })
  );
  applySetCookies(jar, signInResponse.headers.getSetCookie());
  const location = await redirectLocation(signInResponse);
  const state = location ? oauthStateFromLocation(location) : null;
  if (!location || !state || jar.size === 0) throw new Error("Google sign-in could not start");
  return {
    location,
    state,
    cookies: [...jar].map(([name, value]) => ({ name, value })),
  };
}

async function redirectLocation(response: Response): Promise<string | null> {
  const header = response.headers.get("location");
  if (header) return header;
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("json")) return null;
  const payload = (await response.json()) as { url?: unknown };
  return typeof payload.url === "string" ? payload.url : null;
}
