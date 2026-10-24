import { redirect } from "next/navigation";
import LearnerAccessButton from "@/components/LearnerAccessButton";
import { getAppSession } from "@/lib/app-session";
import { appTimeZone } from "@/lib/forecast";
import { listAdminUserSummaries } from "@/lib/multi-user-store";

export default async function AdminUsersPage() {
  const session = await getAppSession();
  if (session?.role !== "admin") redirect("/");
  const users = await listAdminUserSummaries();
  const learners = users.filter((user) => user.role !== "admin");
  const zone = appTimeZone();
  const reviewed = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  return (
    <div className="space-y-5 py-6">
      <header>
        <p className="eyebrow">Admin</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Learner stats</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          Cards studied, reviews, and streaks. Card-by-card progress stays on each learner&apos;s account.
        </p>
      </header>
      {users.some((user) => user.role === "admin") && (
        <p className="text-sm text-muted">Admin accounts are separate and are not counted as learners.</p>
      )}
      {learners.length === 0 && <p className="card p-4 text-sm text-muted">No learner accounts yet.</p>}
      <ul className="space-y-2">
        {learners.map((user) => (
          <li key={user.userId} className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{user.email || "Signed in"}</div>
              <div className="text-xs text-muted">
                Learner
                {user.lastReviewAt ? ` · last review ${reviewed.format(new Date(user.lastReviewAt))}` : " · no reviews yet"}
              </div>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <div><span className="tabular-nums font-semibold">{user.cardsStudied}</span> studied</div>
              <div><span className="tabular-nums font-semibold">{user.reviewCount}</span> reviews</div>
              <div><span className="tabular-nums font-semibold">{user.currentStreak}</span>-day streak</div>
            </div>
            <LearnerAccessButton userId={user.userId} email={user.email} disabled={user.status === "disabled"} />
          </li>
        ))}
      </ul>
    </div>
  );
}
