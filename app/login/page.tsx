import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/app-session";
import { authMode } from "@/lib/flags";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (authMode() === "google") {
    if (await getAppSession()) redirect("/");
    const { error } = await searchParams;
    const { default: GoogleLogin } = await import("@/components/GoogleLogin");
    return <GoogleLogin error={error} />;
  }
  const { default: PasswordLogin } = await import("@/components/PasswordLogin");
  return <PasswordLogin />;
}
