import { redirect } from "next/navigation";
import { getAppSession } from "./app-session";

/** For server component pages: bounce to /login when the session is invalid. */
export async function requireSession(): Promise<void> {
  if (!(await getAppSession())) redirect("/login");
}
