import Link from "next/link";
import ModeLink from "@/components/ModeLink";
import NewDeckButton from "@/components/NewDeckButton";
import WeeklyGoal from "@/components/WeeklyGoal";
import { listAllCards, listDecks } from "@/lib/db";
import { countsByDeck, totalCounts } from "@/lib/due";
import { plural } from "@/lib/plural";
import { hardWords } from "@/lib/study-sets";
import { uniqueWords } from "@/lib/words";

export default async function HomePage() {
  const decks = await listDecks();
  const cards = await listAllCards(decks);
  const now = new Date();
  const totals = totalCounts(cards, now);
  const byDeck = countsByDeck(cards, now);
  const hardCount = uniqueWords(hardWords(cards)).length;
  const canStudy = totals.due + totals.newCards > 0;

  return (
    <div className="space-y-8 py-6">
      <header>
        <p className="eyebrow">学中文</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Chinese Flashcards</h1>
      </header>

      <div className="grid gap-6 lg:grid-cols-5 lg:items-stretch">
        <section className="card flex flex-col overflow-hidden lg:col-span-3">
          <div className="flex-1 p-5 sm:p-6">
            <h2 className="eyebrow">Today</h2>
            <div className="mt-3 flex items-end gap-8">
              <div>
                <div className="text-5xl font-bold tracking-tight text-accent tabular-nums">{totals.due}</div>
                <div className="mt-1 text-sm text-muted">reviews due</div>
              </div>
              <div>
                <div className="text-5xl font-bold tracking-tight tabular-nums">{totals.newCards}</div>
                <div className="mt-1 text-sm text-muted">new words</div>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-2 border-t border-border bg-surface-muted/50 p-4 sm:flex-row">
            {canStudy ? (
              <Link href="/review/all" className="btn btn-primary btn-lg flex-1">Start Review</Link>
            ) : (
              <span aria-disabled="true" className="btn btn-secondary btn-lg flex-1 text-muted">Nothing due</span>
            )}
            <Link href="/decks/all" className="btn btn-secondary btn-lg flex-1 text-base">All study modes</Link>
          </div>
        </section>
        <div className="lg:col-span-2"><WeeklyGoal /></div>
      </div>

      <section aria-labelledby="collections-heading" className="space-y-3">
        <h2 id="collections-heading" className="eyebrow">Study everything</h2>
        <div className="grid gap-2.5 sm:grid-cols-2">
          <ModeLink href="/decks/all" title="All Cards"
            detail={`Every mode across ${plural(decks.length, "deck")}`} badge={totals.due} />
          <ModeLink href="/decks/hard-words" title="★ Hard Words"
            detail={hardCount > 0 ? `${plural(hardCount, "marked word")}` : "Mark tricky words while studying"} />
        </div>
      </section>

      <section aria-labelledby="decks-heading" className="space-y-3">
        <h2 id="decks-heading" className="eyebrow">Decks</h2>
        {decks.length === 0 && (
          <p className="card p-4 text-sm text-muted">No decks yet — create one to get started.</p>
        )}
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {decks.map((deck) => {
            const counts = byDeck.get(deck.id) ?? { total: 0, due: 0, newCards: 0 };
            return (
              <ModeLink key={deck.id} href={`/decks/${deck.id}`} title={deck.name}
                detail={`${plural(counts.total, "card")} · ${counts.due} due · ${counts.newCards} new`}
                badge={counts.due} />
            );
          })}
        </div>
        <NewDeckButton />
      </section>
    </div>
  );
}
