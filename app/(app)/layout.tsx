import AppShell from "@/components/AppShell";
import { requireSession } from "@/lib/session";
import { notoSansSc, notoSerifSc } from "../fonts";

export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await requireSession();
  return (
    <div className={`${notoSansSc.variable} ${notoSerifSc.variable} app-zh min-h-dvh`}>
      <AppShell role={session.role === "admin" ? "admin" : "user"}>{children}</AppShell>
    </div>
  );
}
