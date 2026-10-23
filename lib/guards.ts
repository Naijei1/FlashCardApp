import { redirect } from "next/navigation";
import { getAppSession } from "./app-session";
import { authMode } from "./flags";

/** Admin manages content and never opens a study session. */
export async function redirectAdminFromStudy(): Promise<void> {
  if (authMode() !== "google") return;
  const session = await getAppSession();
  if (session?.role === "admin") redirect("/");
}
