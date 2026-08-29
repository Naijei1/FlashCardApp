import Link from "next/link";
import { notFound } from "next/navigation";
import AddCardForm from "@/components/AddCardForm";
import CardRow from "@/components/CardRow";
import DeckSettings from "@/components/DeckSettings";
import { getDeck, listCards, listDecks } from "@/lib/db";
import { totalCounts } from "@/lib/due";

export default async function DeckPage({
  params,
}: {
  params: Promise<{ deckId: string }>;
}) {
  const { deckId } = await params;
  const [deck, cards, decks] = await Promise.all([
    getDeck(deckId),
    listCards(deckId),
    listDecks(),
  ]);
  if (!deck) notFound();
  const counts = totalCounts(cards, new Date());
  const sorted = [...cards].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="space-y-6 py-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-bold">{deck.name}</h1>
          <p className="text-sm text-muted">
            {counts.total} card{counts.total === 1 ? "" : "s"} · {counts.due} due ·{" "}
            {counts.newCards} new
          </p>
        </div>
        <DeckSettings deck={deck} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Link
          href={`/review/${deck.id}`}
          className="rounded-xl bg-accent px-4 py-3 text-center font-medium text-accent-foreground"
        >
          Review ({counts.due})
        </Link>
        <Link
          href={`/study/${deck.id}`}
          className="rounded-xl border border-border bg-surface px-4 py-3 text-center font-medium"
        >
          Study
        </Link>
        <Link
          href={`/import?deck=${deck.id}`}
          className="rounded-xl border border-border bg-surface px-4 py-3 text-center font-medium"
        >
          Import CSV
        </Link>
        <a
          href={`/api/decks/${deck.id}/export`}
          className="rounded-xl border border-border bg-surface px-4 py-3 text-center font-medium"
        >
          Export CSV
        </a>
      </div>

      <AddCardForm deckId={deck.id} />

      <section className="space-y-2">
        {sorted.length === 0 && (
          <p className="text-sm text-muted">No cards yet — add one above or import a CSV.</p>
        )}
        {sorted.map((card) => (
          <CardRow key={card.id} card={card} decks={decks} frontLang={deck.frontLanguage} />
        ))}
      </section>
    </div>
  );
}
