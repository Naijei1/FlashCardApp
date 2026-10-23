import Link from "next/link";
import { listDecks } from "@/lib/db";
import { releaseWeekLabel } from "@/lib/multi-user-model";
import { listAdminUserSummaries } from "@/lib/multi-user-store";

export default async function AdminHome() {
  const [decks, users] = await Promise.all([listDecks(), listAdminUserSummaries()]);
  const learners = users.filter((user) => user.role !== "admin");
  return (
    <div className="space-y-8 py-6">
      <header>
        <p className="eyebrow">Admin</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Content and learners</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          This account manages global decks. It cannot study, and it only sees overall stats — cards studied, review counts, and streaks — never which card someone missed.
        </p>
      </header>
      <div className="flex flex-wrap gap-2">
        <Link href="/admin/upload" className="btn btn-primary">Upload a week</Link>
        <Link href="/admin/users" className="btn btn-secondary">Learner stats</Link>
      </div>
      <section className="space-y-3">
        <h2 className="eyebrow">Global decks</h2>
        {decks.length === 0 && <p className="card p-4 text-sm text-muted">No global decks yet.</p>}
        <ul className="grid gap-2 sm:grid-cols-2">
          {decks.map((deck) => (
            <li key={deck.id}>
              <Link href={`/decks/${deck.id}`} className="card block p-4">
                <div className="font-semibold">{deck.name}</div>
                <div className="mt-1 text-sm text-muted">
                  {deck.status === "scheduled" && deck.releaseWeek
                    ? releaseWeekLabel(deck.releaseWeek)
                    : deck.status === "published" || !deck.status
                      ? "Released"
                      : "Draft"}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <section className="space-y-3">
        <h2 className="eyebrow">Learners</h2>
        <p className="text-sm text-muted">{learners.length} learner accounts</p>
      </section>
    </div>
  );
}
