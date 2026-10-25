import { encode } from "@auth/core/jwt";
import { SESSION_MAX_AGE_SECONDS } from "./constants";
import { roleForVerifiedEmail } from "./multi-user-model";
import { validHandoffSession, type HandoffSession } from "./pwa-handoff";

/** Same names Auth.js derives from the request protocol. The salt is the cookie name. */
export function authSessionCookieName(secure: boolean): string {
  return `${secure ? "__Secure-" : ""}authjs.session-token`;
}

export function authCookiesAreSecure(request: Request): boolean {
  const configured = process.env.AUTH_URL || process.env.NEXTAUTH_URL;
  if (configured) return configured.startsWith("https://");
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (forwarded) return forwarded === "https";
  return new URL(request.url).protocol === "https:";
}

export function sessionCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure,
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

/**
 * Mints the Auth.js JWT session cookie for a browser that did not receive the
 * callback. Claims match `googleJwt` so `readGoogleSession` accepts it.
 */
export async function encodeAppSession(
  secret: string,
  session: HandoffSession,
  secure: boolean
): Promise<{ name: string; value: string }> {
  if (!validHandoffSession(session)) throw new Error("invalid handoff session");
  const email = session.email.trim();
  const name = authSessionCookieName(secure);
  const value = await encode({
    secret,
    salt: name,
    maxAge: SESSION_MAX_AGE_SECONDS,
    token: {
      sub: session.appUserId,
      email,
      appUserId: session.appUserId,
      emailVerified: true,
      sessionId: session.sessionId,
      sessionVersion: session.sessionVersion,
      role: roleForVerifiedEmail(email, true),
    },
  });
  return { name, value };
}
