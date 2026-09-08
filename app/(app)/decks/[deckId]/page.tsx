import Link from "next/link";
import { notFound } from "next/navigation";
import AddCardForm from "@/components/AddCardForm";
import CardPagination from "@/components/CardPagination";
import { IconChevronRight } from "@/components/icons";
import CardRow from "@/components/CardRow";
import DeckSettings from "@/components/DeckSettings";
import { getDeck, listCards, listDecks } from "@/lib/db";
import { totalCounts } from "@/lib/due";

const PAGE_SIZE = 50;

function requestedPage(value: string | undefined): number {
  const page = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

export default async function DeckPage({
  params,
  searchParams,
}: {
  params: Promise<{ deckId: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const [{ deckId }, { page: pageParam }] = await Promise.all([params, searchParams]);
  const [deck, cards, decks] = await Promise.all([
    getDeck(deckId),
    listCards(deckId),
    listDecks(),
  ]);
  if (!deck) notFound();
  const counts = totalCounts(cards, new Date());
  const sorted = [...cards].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const page = Math.min(requestedPage(pageParam), totalPages);
  const pageStart = (page - 1) * PAGE_SIZE;
  const shown = sorted.slice(pageStart, pageStart + PAGE_SIZE);
  const shownFrom = shown.length > 0 ? pageStart + 1 : 0;
  const shownTo = pageStart + shown.length;

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
          <IconChevronRight className="text-xl opacity-70" />
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
          <IconChevronRight className="text-xl text-muted" />
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
          <IconChevronRight className="text-xl text-muted" />
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

      <section aria-labelledby="deck-cards-heading" className="space-y-2">
        <div className="flex items-baseline justify-between gap-3 px-1">
          <h2
            id="deck-cards-heading"
            className="text-sm font-medium uppercase tracking-wide text-muted"
          >
            Cards
          </h2>
          {shown.length > 0 && (
            <span className="text-xs tabular-nums text-muted">
              Showing {shownFrom}–{shownTo} of {sorted.length}
            </span>
          )}
        </div>
        {sorted.length === 0 && (
          <p className="text-sm text-muted">No cards yet — add one above or import a CSV.</p>
        )}
        <ul className="space-y-2">
          {shown.map((card) => (
            <li key={`${card.deckId}:${card.id}`}>
              <CardRow card={card} decks={decks} frontLang={deck.frontLanguage} />
            </li>
          ))}
        </ul>
        <CardPagination
          basePath={`/decks/${deck.id}`}
          currentPage={page}
          totalPages={totalPages}
        />
      </section>
    </div>
  );
}
