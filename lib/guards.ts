import { redirect } from "next/navigation";
import { getAppSession } from "./app-session";
import { authMode } from "./flags";

/** Admin manages content and never opens a study session. */
export async function redirectAdminFromStudy(): Promise<void> {
  if (authMode() !== "google") return;
  const session = await getAppSession();
  if (session?.role === "admin") redirect("/?adminStudy=1");
}

/** Learner-only pages that read per-user items: signed out goes to login, admin goes home. */
export async function requireLearnerPage(): Promise<void> {
  const session = await getAppSession();
  if (!session) redirect("/login");
  if (session.role === "admin") redirect("/?adminStudy=1");
}
