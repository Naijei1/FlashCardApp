import { NextResponse } from "next/server";
import { getAuthSession, type AuthSession } from "./auth";

/** Returns a 401 response when unauthenticated, else null. */
export async function requireAuth(): Promise<NextResponse | null> {
  if (await getAuthSession()) return null;
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export async function requireSession(): Promise<
  { session: AuthSession; response: null } | { session: null; response: NextResponse }
> {
  const session = await getAuthSession();
  if (session) return { session, response: null };
  return { session: null, response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
}

export async function requireRegularUser(): Promise<
  { session: AuthSession; response: null } | { session: null; response: NextResponse }
> {
  const result = await requireSession();
  if (result.response) return result;
  if (!result.session.isAdmin) return result;
  return {
    session: null,
    response: NextResponse.json(
      { error: "admin accounts cannot study or create progress" },
      { status: 403 }
    ),
  };
}

export async function requireAdmin(): Promise<
  { session: AuthSession; response: null } | { session: null; response: NextResponse }
> {
  const result = await requireSession();
  if (result.response) return result;
  if (result.session.isAdmin) return result;
  return {
    session: null,
    response: NextResponse.json({ error: "admin role required" }, { status: 403 }),
  };
}

export function contentAccessResponse(error: unknown): NextResponse | null {
  if (error instanceof Error && error.name === "ContentAccessError") {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  return null;
}

export function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

export function notFound(message = "not found"): NextResponse {
  return NextResponse.json({ error: message }, { status: 404 });
}
