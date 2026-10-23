import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { resolveGoogleUser } from "./accounts";
import { roleForVerifiedEmail } from "./multi-user-model";
import type { AppSession } from "./principal";

type GoogleAuth = ReturnType<typeof NextAuth>;

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
      async signIn({ account, profile }) {
        if (account?.provider !== "google") return false;
        const identity = googleIdentity(profile, account);
        // Open signup, but only for an address Google has verified.
        return identity?.emailVerified === true;
      },
      async jwt({ token, account, profile }) {
        if (account && profile) {
          const identity = googleIdentity(profile, account);
          if (!identity?.emailVerified) return token;
          const user = await resolveGoogleUser(identity);
          token.appUserId = user.userId;
          token.email = user.email;
          token.emailVerified = true;
        }
        const email = typeof token.email === "string" ? token.email : "";
        token.role = roleForVerifiedEmail(email, token.emailVerified === true);
        return token;
      },
      async session({ session, token }) {
        const next = session as typeof session & {
          appUserId?: string;
          role?: "admin" | "user";
          emailVerified?: boolean;
        };
        next.appUserId = typeof token.appUserId === "string" ? token.appUserId : undefined;
        next.emailVerified = token.emailVerified === true;
        next.role = token.role === "admin" ? "admin" : "user";
        if (next.user && typeof token.email === "string") next.user.email = token.email;
        return next;
      },
    },
  });
  return cached;
}

export async function readGoogleSession(): Promise<AppSession | null> {
  const session = await googleAuth().auth();
  if (!session) return null;
  const extra = session as typeof session & { appUserId?: string; emailVerified?: boolean };
  if (!extra.appUserId || extra.emailVerified !== true) return null;
  const email = session.user?.email ?? "";
  return {
    userId: extra.appUserId,
    email,
    role: roleForVerifiedEmail(email, true),
    emailVerified: true,
    authMode: "google",
  };
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
