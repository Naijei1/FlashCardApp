import AppShell from "@/components/AppShell";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await requireSession();
  return <AppShell>{children}</AppShell>;
}
