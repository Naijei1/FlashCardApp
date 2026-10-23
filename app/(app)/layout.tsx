import AppShell from "@/components/AppShell";
import { requireSession } from "@/lib/session";
import { notoSansSc, notoSerifSc } from "../fonts";

export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await requireSession();
  return (
    <div className={`${notoSansSc.variable} ${notoSerifSc.variable} app-zh min-h-dvh`}>
      <AppShell>{children}</AppShell>
    </div>
  );
}
