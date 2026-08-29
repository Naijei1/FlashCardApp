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

      <div className="space-y-2">
        <Link
          href={`/review/${deck.id}`}
          className="pressable flex items-center justify-between rounded-2xl bg-accent px-5 py-4 text-accent-foreground"
        >
          <span>
            <span className="block text-lg font-semibold">Spaced Repetition</span>
            <span className="block text-sm opacity-80">
              {counts.due > 0
                ? `Review ${counts.due} due card${counts.due === 1 ? "" : "s"}`
                : "Nothing due right now"}
            </span>
          </span>
          <span aria-hidden className="text-xl opacity-70">
            ›
          </span>
        </Link>
        <Link
          href={`/study/${deck.id}`}
          className="pressable flex items-center justify-between rounded-2xl border border-border bg-surface px-5 py-4"
        >
          <span>
            <span className="block text-lg font-semibold">Normal Review</span>
            <span className="block text-sm text-muted">
              Browse cards freely — doesn&apos;t affect scheduling
            </span>
          </span>
          <span aria-hidden className="text-xl text-muted">
            ›
          </span>
        </Link>
        <Link
          href={`/write/${deck.id}`}
          className="pressable flex items-center justify-between rounded-2xl border border-border bg-surface px-5 py-4"
        >
          <span>
            <span className="block text-lg font-semibold">Write Chinese</span>
            <span className="block text-sm text-muted">
              See English and type the Chinese answer
            </span>
          </span>
          <span aria-hidden className="text-xl text-muted">
            ›
          </span>
        </Link>
      </div>

      <div className="flex gap-4 px-1 text-sm">
        <Link href={`/import?deck=${deck.id}`} className="text-accent">
          Import CSV
        </Link>
        <a href={`/api/decks/${deck.id}/export`} className="text-accent">
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
