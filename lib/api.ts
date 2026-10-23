import { NextResponse } from "next/server";
import { AccessError } from "./access-error";
import { getAppSession } from "./app-session";

/** Returns a 401 response when unauthenticated, else null. */
export async function requireAuth(): Promise<NextResponse | null> {
  if (await getAppSession()) return null;
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

/** Study, review, and personal progress. Admin accounts are rejected. */
export async function requireRegularUser(): Promise<NextResponse | null> {
  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.role === "admin") {
    return NextResponse.json({ error: "admin accounts cannot study" }, { status: 403 });
  }
  return null;
}

/** Global content and overall learner stats. Shared-password mode has no admin. */
export async function requireAdmin(): Promise<NextResponse | null> {
  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.authMode !== "google" || session.role !== "admin" || !session.emailVerified) {
    return NextResponse.json({ error: "admin only" }, { status: 403 });
  }
  return null;
}

export function accessErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof AccessError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return null;
}

export function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

export function notFound(message = "not found"): NextResponse {
  return NextResponse.json({ error: message }, { status: 404 });
}
