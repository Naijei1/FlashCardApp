import CardRow from "@/components/CardRow";
import CardPagination from "@/components/CardPagination";
import { listAllCards, listDecks } from "@/lib/db";

const PAGE_SIZE = 50;

function requestedPage(value: string | undefined): number {
  const page = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { q = "", page: pageParam } = await searchParams;
  const decks = await listDecks();
  const cards = await listAllCards(decks);
  const deckName = new Map(decks.map((d) => [d.id, d.name]));
  const deckFrontLang = new Map(decks.map((d) => [d.id, d.frontLanguage]));

  const trimmedQuery = q.trim();
  const query = trimmedQuery.toLowerCase();
  const matches = query
    ? cards.filter(
        (c) =>
          c.front.toLowerCase().includes(query) ||
          c.back.toLowerCase().includes(query) ||
          (c.notes ?? "").toLowerCase().includes(query)
      )
    : cards;
  const sorted = [...matches].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const page = Math.min(requestedPage(pageParam), totalPages);
  const pageStart = (page - 1) * PAGE_SIZE;
  const shown = sorted.slice(pageStart, pageStart + PAGE_SIZE);
  const shownFrom = shown.length > 0 ? pageStart + 1 : 0;
  const shownTo = pageStart + shown.length;

  return (
    <div className="space-y-4 py-6">
      <h1 className="text-2xl font-bold">Browse</h1>
      <form role="search" method="GET" action="/browse">
        <label htmlFor="card-search" className="sr-only">
          Search cards
        </label>
        <input
          id="card-search"
          type="search"
          name="q"
          defaultValue={q}
          aria-describedby="search-summary"
          placeholder="Search front, back, or notes…"
          className="w-full rounded-xl border border-border bg-surface px-4 py-3 outline-none focus:border-accent"
        />
      </form>
      <p id="search-summary" className="text-sm text-muted">
        {matches.length} card{matches.length === 1 ? "" : "s"}
        {matches.length > 0 ? ` · showing ${shownFrom}–${shownTo}` : ""}
      </p>
      <section aria-labelledby="card-results-heading">
        <h2 id="card-results-heading" className="sr-only">
          Card results
        </h2>
        {shown.length === 0 && <p className="text-sm text-muted">No cards found.</p>}
        <ul className="space-y-2">
          {shown.map((card) => (
            <li key={`${card.deckId}:${card.id}`}>
              <div className="mb-0.5 px-1 text-xs text-muted">
                {deckName.get(card.deckId) ?? "Unknown deck"}
              </div>
              <CardRow card={card} decks={decks} frontLang={deckFrontLang.get(card.deckId)} />
            </li>
          ))}
        </ul>
      </section>
      <CardPagination
        basePath="/browse"
        currentPage={page}
        totalPages={totalPages}
        query={{ q: trimmedQuery || undefined }}
      />
    </div>
  );
}
