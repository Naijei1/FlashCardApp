import { redirect } from "next/navigation";
import { getSession, type SessionPrincipal } from "./auth";

/** For server component pages: bounce to /login when the session is missing or revoked. */
export async function requireSession(): Promise<SessionPrincipal> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}
