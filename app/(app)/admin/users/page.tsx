import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/app-session";
import { listAdminUserSummaries } from "@/lib/multi-user-store";

export default async function AdminUsersPage() {
  const session = await getAppSession();
  if (session?.role !== "admin") redirect("/");
  const users = await listAdminUserSummaries();
  return (
    <div className="space-y-5 py-6">
      <header>
        <p className="eyebrow">Admin</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Learner stats</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          Cards studied, reviews, and streaks. Card-by-card progress stays on each learner&apos;s account.
        </p>
      </header>
      {users.length === 0 && <p className="card p-4 text-sm text-muted">No accounts yet.</p>}
      <ul className="space-y-2">
        {users.map((user) => (
          <li key={user.userId} className="card grid gap-2 p-4 sm:grid-cols-[1fr_auto_auto_auto]">
            <div>
              <div className="font-semibold">{user.email || "Signed in"}</div>
              <div className="text-xs text-muted">{user.role === "admin" ? "Admin" : "Learner"}</div>
            </div>
            <div className="text-sm"><span className="tabular-nums font-semibold">{user.cardsStudied}</span> studied</div>
            <div className="text-sm"><span className="tabular-nums font-semibold">{user.reviewCount}</span> reviews</div>
            <div className="text-sm"><span className="tabular-nums font-semibold">{user.currentStreak}</span>-day streak</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
