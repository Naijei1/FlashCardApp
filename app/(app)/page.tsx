import Link from "next/link";
import WeeklyGoal from "@/components/WeeklyGoal";
import NewDeckButton from "@/components/NewDeckButton";
import { listAllCards, listDecks } from "@/lib/db";
import { countsByDeck, totalCounts } from "@/lib/due";

export default async function HomePage() {
  const decks = await listDecks();
  const cards = await listAllCards(decks);
  const now = new Date();
  const totals = totalCounts(cards, now);
  const byDeck = countsByDeck(cards, now);

  return (
    <div className="space-y-8 py-6">
      <h1 className="text-2xl font-bold">Chinese Flashcards</h1>

      <section className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted">Today</h2>
        <div className="mt-3 flex items-end gap-6">
          <div>
            <div className="text-4xl font-bold text-accent">{totals.due}</div>
            <div className="text-sm text-muted">due words</div>
          </div>
          <div>
            <div className="text-4xl font-bold">{totals.newCards}</div>
            <div className="text-sm text-muted">new words</div>
          </div>
        </div>
        {totals.due > 0 ? (
          <Link
            href="/review/all"
            className="mt-5 block w-full rounded-xl bg-accent px-4 py-3 text-center text-lg font-medium text-accent-foreground"
          >
            Start Review
          </Link>
        ) : (
          <span
            aria-disabled="true"
            className="mt-5 block w-full rounded-xl border border-border px-4 py-3 text-center text-lg font-medium text-muted"
          >
            Nothing due
          </span>
        )}
      </section>

      <WeeklyGoal />

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted">Decks</h2>
        {decks.length === 0 && (
          <p className="text-sm text-muted">No decks yet — create one to get started.</p>
        )}
        {decks.map((deck) => {
          const counts = byDeck.get(deck.id) ?? { total: 0, due: 0, newCards: 0 };
          return (
            <Link
              key={deck.id}
              href={`/decks/${deck.id}`}
              className="flex items-center justify-between rounded-2xl border border-border bg-surface p-4 hover:border-accent"
            >
              <div>
                <div className="font-medium">{deck.name}</div>
                <div className="text-sm text-muted">
                  {counts.total} card{counts.total === 1 ? "" : "s"} · {counts.due} due words
                </div>
              </div>
              {counts.due > 0 && (
                <span className="rounded-full bg-accent/15 px-3 py-1 text-sm font-medium text-accent">
                  {counts.due}
                </span>
              )}
            </Link>
          );
        })}
        <NewDeckButton />
      </section>
    </div>
  );
}
