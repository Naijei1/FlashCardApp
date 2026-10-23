import { headers } from "next/headers";
import NextAuth from "next-auth";
import type { JWT } from "next-auth/jwt";
import type { Session } from "next-auth";
import Google from "next-auth/providers/google";
import { resolveGoogleUser } from "./accounts";
import { beginSession, limitSharedLogin, sessionIsCurrent } from "./auth-store";
import { clientAddressKey } from "./login-limit";
import { roleForVerifiedEmail } from "./multi-user-model";
import type { AppSession } from "./principal";

type GoogleAuth = ReturnType<typeof NextAuth>;

export type GoogleAuthState = AppSession & {
  sessionId: string;
  sessionVersion: number;
};

let cached: GoogleAuth | null = null;

function hydrate(name: "AUTH_SECRET" | "AUTH_GOOGLE_SECRET"): void {
  const encoded = process.env[`${name}_HEX`];
  if (!encoded) return;
  if (encoded.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(encoded)) {
    throw new Error(`${name}_HEX is invalid`);
  }
  process.env[name] = Buffer.from(encoded, "hex").toString("utf8");
}

function googleIdentity(profile: unknown, account: { provider?: string; providerAccountId?: string } | null | undefined) {
  if (!profile || typeof profile !== "object") return null;
  const record = profile as Record<string, unknown>;
  const email = typeof record.email === "string" ? record.email : "";
  const sub = account?.providerAccountId || (typeof record.sub === "string" ? record.sub : "");
  return { sub, email, emailVerified: record.email_verified === true };
}

type GoogleAccount = { provider?: string; providerAccountId?: string } | null | undefined;

/**
 * Same DynamoDB attempt row as the shared password. An unverified Google email
 * counts as a failure. A block refuses the callback until the window passes.
 */
export async function googleSignIn(args: {
  account?: GoogleAccount;
  profile?: unknown;
}): Promise<boolean | string> {
  if (args.account?.provider !== "google") return false;
  const identity = googleIdentity(args.profile, args.account);
  const verified = identity?.emailVerified === true;
  const headerList = await headers();
  let result;
  try {
    result = await limitSharedLogin(clientAddressKey(headerList), Date.now(), async () => verified);
  } catch (error) {
    console.error("Google sign-in rate limit failed", error instanceof Error ? error.name : "unknown");
    return "/login?error=TryAgain";
  }
  if (result.status === "blocked") return "/login?error=TooManyAttempts";
  if (result.status !== "allowed") return false;
  return true;
}

/** Issues a revocable SESSION# row for the app user id, not the Google subject. */
export async function googleJwt(args: {
  token: JWT;
  account?: GoogleAccount;
  profile?: unknown;
}): Promise<JWT> {
  const token = args.token;
  if (args.account && args.profile) {
    const identity = googleIdentity(args.profile, args.account);
    if (identity?.emailVerified) {
      const user = await resolveGoogleUser(identity);
      const issued = await beginSession(user.userId);
      token.appUserId = user.userId;
      token.email = user.email;
      token.emailVerified = true;
      token.sessionId = issued.sessionId;
      token.sessionVersion = issued.sessionVersion;
    }
  }
  const email = typeof token.email === "string" ? token.email : "";
  token.role = roleForVerifiedEmail(email, token.emailVerified === true);
  return token;
}

export async function googleSession(args: { session: Session; token: JWT }): Promise<Session> {
  const next = args.session as Session & Partial<GoogleAuthState>;
  const token = args.token;
  next.appUserId = typeof token.appUserId === "string" ? token.appUserId : undefined;
  next.emailVerified = token.emailVerified === true;
  next.role = token.role === "admin" ? "admin" : "user";
  next.sessionId = typeof token.sessionId === "string" ? token.sessionId : undefined;
  next.sessionVersion = typeof token.sessionVersion === "number" ? token.sessionVersion : undefined;
  if (next.user && typeof token.email === "string") next.user.email = token.email;
  return next;
}

export function googleAuth(): GoogleAuth {
  if (cached) return cached;
  hydrate("AUTH_SECRET");
  hydrate("AUTH_GOOGLE_SECRET");
  cached = NextAuth({
    trustHost: true,
    session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 30 },
    pages: { signIn: "/login", error: "/login" },
    providers: [
      Google({
        clientId: process.env.AUTH_GOOGLE_ID,
        clientSecret: process.env.AUTH_GOOGLE_SECRET,
      }),
    ],
    callbacks: {
      signIn: googleSignIn,
      jwt: googleJwt,
      session: googleSession,
    },
  });
  return cached;
}

function stateFromSession(session: Session): GoogleAuthState | null {
  const extra = session as Session & Partial<GoogleAuthState>;
  if (!extra.appUserId || extra.emailVerified !== true) return null;
  if (typeof extra.sessionId !== "string" || typeof extra.sessionVersion !== "number") return null;
  const email = session.user?.email ?? "";
  return {
    userId: extra.appUserId,
    email,
    role: roleForVerifiedEmail(email, true),
    emailVerified: true,
    authMode: "google",
    sessionId: extra.sessionId,
    sessionVersion: extra.sessionVersion,
  };
}

/** Auth.js claims only. Logout uses this so a revoked browser can still be signed out. */
export async function readGoogleAuthState(): Promise<GoogleAuthState | null> {
  const session = await googleAuth().auth();
  if (!session) return null;
  return stateFromSession(session);
}

export async function readGoogleSession(): Promise<AppSession | null> {
  const state = await readGoogleAuthState();
  if (!state) return null;
  const current = await sessionIsCurrent(state.userId, state.sessionId, state.sessionVersion);
  if (!current) return null;
  return state;
}

export async function signInWithGoogleProvider(): Promise<void> {
  await googleAuth().signIn("google", { redirectTo: "/" });
}

export async function signOutGoogle(): Promise<void> {
  await googleAuth().signOut({ redirect: false });
}

export async function handleGoogleAuth(method: "GET" | "POST", request: Request): Promise<Response> {
  const handler = googleAuth().handlers[method];
  return handler(request as Parameters<typeof handler>[0]);
}
