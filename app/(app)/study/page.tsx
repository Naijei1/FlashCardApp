import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/app-session";

export default async function StudyIndexPage() {
  if (!(await getAppSession())) redirect("/login");
  redirect("/");
}
