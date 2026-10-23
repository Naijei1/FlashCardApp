import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/app-session";
import { authMode } from "@/lib/flags";
import LoginForm from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  // A DynamoDB blip should show the form, not bounce between / and /login.
  const session = await getAppSession().catch(() => null);
  if (session) redirect("/");
  if (authMode() === "google") {
    const { error } = await searchParams;
    const { default: GoogleLogin } = await import("@/components/GoogleLogin");
    return <GoogleLogin error={error} />;
  }
  return <LoginForm />;
}
