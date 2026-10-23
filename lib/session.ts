import { redirect } from "next/navigation";
import { getAppSession } from "./app-session";
import type { AppSession } from "./principal";

/** Bounce to /login when the session is missing or revoked. */
export async function requireSession(): Promise<AppSession> {
  const session = await getAppSession();
  if (!session) redirect("/login");
  return session;
}
