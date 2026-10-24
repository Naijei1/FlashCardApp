import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/app-session";

export default async function AdminIndexPage() {
  if (!(await getAppSession())) redirect("/login");
  redirect("/");
}
