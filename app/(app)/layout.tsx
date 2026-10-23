import AppShell from "@/components/AppShell";
import { getAppSession } from "@/lib/app-session";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await requireSession();
  const session = await getAppSession();
  return <AppShell role={session?.role === "admin" ? "admin" : "user"}>{children}</AppShell>;
}
