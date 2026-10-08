import { createRemoteJWKSet, jwtVerify, SignJWT, type JWTPayload } from "jose";
import { createHash, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";

import { SESSION_COOKIE } from "./constants";

export { SESSION_COOKIE };
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const ADMIN_GROUP = "admins";

export type UserRole = "admin" | "user";

export type AuthSession = {
  userId: string;
  email?: string;
  role: UserRole;
  isAdmin: boolean;
};

export type AuthMode = "shared" | "cognito" | "local-dev";

export function authMode(): AuthMode {
  const configured = process.env.AUTH_MODE;
  if (!configured || configured === "shared") return "shared";
  if (configured === "cognito" || configured === "local-dev") return configured;
  throw new Error("AUTH_MODE must be shared, cognito, or local-dev");
}

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

export async function signSession(session?: Partial<AuthSession>): Promise<string> {
  return new SignJWT(
    session
      ? {
          sub: session.userId,
          email: session.email,
          role: session.role,
        }
      : {}
  )
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(secretKey());
}

export async function verifySessionToken(token: string): Promise<boolean> {
  return (await verifySharedSessionToken(token)) !== null;
}

async function verifySharedSessionToken(token: string): Promise<AuthSession | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    const role = payload.role === "admin" ? "admin" : "user";
    const userId = typeof payload.sub === "string" && payload.sub ? payload.sub : "legacy-user";
    return {
      userId,
      email: typeof payload.email === "string" ? payload.email : undefined,
      role,
      isAdmin: role === "admin",
    };
  } catch {
    return null;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_MAX_AGE_SECONDS,
};

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function cognitoIssuer(): string {
  const issuer =
    process.env.COGNITO_ISSUER ||
    (process.env.COGNITO_USER_POOL_ID && process.env.APP_REGION
      ? `https://cognito-idp.${process.env.APP_REGION}.amazonaws.com/${process.env.COGNITO_USER_POOL_ID}`
      : "");
  if (!issuer) throw new Error("COGNITO_ISSUER or COGNITO_USER_POOL_ID/APP_REGION is required");
  return issuer.replace(/\/$/, "");
}

function cognitoAudience(): string {
  const audience = process.env.COGNITO_CLIENT_ID;
  if (!audience) throw new Error("COGNITO_CLIENT_ID is required");
  return audience;
}

function bearerToken(value: string | null): string | null {
  if (!value?.startsWith("Bearer ")) return null;
  const token = value.slice("Bearer ".length).trim();
  return token || null;
}

async function cognitoTokenFromRequest(): Promise<string | null> {
  const [store, headerStore] = await Promise.all([cookies(), headers()]);
  return (
    bearerToken(headerStore.get("authorization")) ||
    store.get(SESSION_COOKIE)?.value ||
    store.get("id_token")?.value ||
    null
  );
}

/** Role comes only from the Cognito `admins` group, never from a caller-supplied claim. */
export function sessionFromCognitoClaims(payload: JWTPayload): AuthSession | null {
  if (payload.token_use !== "id") return null;
  const rawGroups = payload["cognito:groups"];
  const groups = Array.isArray(rawGroups)
    ? rawGroups
    : typeof rawGroups === "string"
      ? [rawGroups]
      : [];
  const role: UserRole = groups.includes(ADMIN_GROUP) ? "admin" : "user";
  const userId = typeof payload.sub === "string" ? payload.sub : "";
  if (!userId || userId.includes("#")) return null;
  return {
    userId,
    email: typeof payload.email === "string" ? payload.email : undefined,
    role,
    isAdmin: role === "admin",
  };
}

export async function verifyCognitoIdToken(
  token: string
): Promise<{ session: AuthSession; expiresAt: number } | null> {
  const issuer = cognitoIssuer();
  jwks ??= createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer,
      audience: cognitoAudience(),
    });
    const session = sessionFromCognitoClaims(payload);
    if (!session || typeof payload.exp !== "number") return null;
    return { session, expiresAt: payload.exp };
  } catch {
    return null;
  }
}

async function verifyCognitoSession(): Promise<AuthSession | null> {
  const token = await cognitoTokenFromRequest();
  if (!token) return null;
  return (await verifyCognitoIdToken(token))?.session ?? null;
}

async function localDevSession(): Promise<AuthSession | null> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_MODE=local-dev cannot be used in production");
  }
  const headerStore = await headers();
  const role = headerStore.get("x-flashcards-dev-role") === "admin" ? "admin" : "user";
  const userId =
    headerStore.get("x-flashcards-dev-user-id") ||
    process.env.LOCAL_DEV_USER_ID ||
    "local-user";
  return {
    userId,
    email: headerStore.get("x-flashcards-dev-email") || process.env.LOCAL_DEV_EMAIL || undefined,
    role,
    isAdmin: role === "admin",
  };
}

export async function getAuthSession(): Promise<AuthSession | null> {
  switch (authMode()) {
    case "shared": {
      const store = await cookies();
      const token = store.get(SESSION_COOKIE)?.value;
      return token ? verifySharedSessionToken(token) : null;
    }
    case "cognito":
      return verifyCognitoSession();
    case "local-dev":
      return localDevSession();
  }
}

/** True when the request carries a valid session cookie or account token. */
export async function isAuthenticated(): Promise<boolean> {
  return (await getAuthSession()) !== null;
}

export function legacyUserSession(): AuthSession {
  return { userId: "legacy-user", role: "user", isAdmin: false };
}

export async function currentAuthSessionOrLegacy(): Promise<AuthSession> {
  return (await getAuthSession()) ?? legacyUserSession();
}
