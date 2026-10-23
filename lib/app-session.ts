import { isAuthenticated } from "./auth";
import { authMode } from "./flags";
import type { AppSession } from "./principal";

/**
 * Shared-password sessions stay a single learner. Google sessions carry the
 * stable app user id and a role recomputed from ADMIN_EMAILS.
 */
export async function getAppSession(): Promise<AppSession | null> {
  if (authMode() !== "google") {
    if (!(await isAuthenticated())) return null;
    return {
      userId: "shared",
      email: "",
      role: "user",
      emailVerified: true,
      authMode: "shared",
    };
  }
  const { readGoogleSession } = await import("./google-auth");
  return readGoogleSession();
}
