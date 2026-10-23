import { SignJWT, jwtVerify } from "jose";
import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

import { sessionIsCurrent } from "./auth-store";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "./constants";

export { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS };

export type SessionPrincipal = {
  userId: string;
  sessionId: string;
  sessionVersion: number;
};

const USER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SESSION_ID = /^[A-Za-z0-9_-]{16,128}$/;

function privateEnv(name: "APP_PASSWORD" | "SESSION_SECRET"): string | undefined {
  const encoded = process.env[`${name}_HEX`];
  if (!encoded) return process.env[name];
  if (encoded.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(encoded)) {
    throw new Error(`${name}_HEX is invalid`);
  }
  return Buffer.from(encoded, "hex").toString("utf8");
}

function secretKey(): Uint8Array {
  const secret = privateEnv("SESSION_SECRET");
  if (!secret) throw new Error("SESSION_SECRET is not set");
  if (process.env.NODE_ENV === "production" && secret.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters in production");
  }
  return new TextEncoder().encode(secret);
}

/** Constant-time compare via SHA-256 digests (sidesteps length mismatch throw). */
export function checkPassword(input: string): boolean {
  const expected = privateEnv("APP_PASSWORD");
  if (!expected) return false;
  const a = createHash("sha256").update(input, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

export async function signSession(claims: SessionPrincipal): Promise<string> {
  return new SignJWT({ sid: claims.sessionId, sv: claims.sessionVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(secretKey());
}

/** Signature, expiry, and claim shape. Revocation is checked in getSession. */
export async function readSessionClaims(token: string): Promise<SessionPrincipal | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    const userId = payload.sub;
    const sessionId = payload.sid;
    const sessionVersion = payload.sv;
    if (typeof userId !== "string" || !USER_ID.test(userId)) return null;
    if (typeof sessionId !== "string" || !SESSION_ID.test(sessionId)) return null;
    if (typeof sessionVersion !== "number" || !Number.isSafeInteger(sessionVersion) || sessionVersion < 1) {
      return null;
    }
    return { userId, sessionId, sessionVersion };
  } catch {
    return null;
  }
}

export async function verifySessionToken(token: string): Promise<boolean> {
  return (await readSessionClaims(token)) !== null;
}

/**
 * Valid signature is not enough: the session row must still exist and its
 * version must match. Logout deletes the row; log out everywhere bumps the
 * version so other browsers fail too.
 */
export async function getSession(): Promise<SessionPrincipal | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const claims = await readSessionClaims(token);
  if (!claims) return null;
  const active = await sessionIsCurrent(claims.userId, claims.sessionId, claims.sessionVersion);
  return active ? claims : null;
}

export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_MAX_AGE_SECONDS,
};

/** True when the request carries a signed session that has not been revoked. */
export async function isAuthenticated(): Promise<boolean> {
  return (await getSession()) !== null;
}
