import { redirect } from "next/navigation";
import { isAuthenticated } from "./auth";

/** For server component pages: bounce to /login when the session is invalid. */
export async function requireSession(): Promise<void> {
  if (!(await isAuthenticated())) redirect("/login");
}
