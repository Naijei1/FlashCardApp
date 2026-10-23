import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import LoginForm from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  // A DynamoDB blip should show the form, not bounce between / and /login.
  const session = await getSession().catch(() => null);
  if (session) redirect("/");
  return <LoginForm />;
}
