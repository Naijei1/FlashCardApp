import CardList from "@/components/CardList";
import CardPagination from "@/components/CardPagination";
import SearchForm from "@/components/SearchForm";
import { listAllCards, listDecks } from "@/lib/db";
import { plural } from "@/lib/plural";

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

  return (
    <div className="space-y-5 py-6">
      <h1 className="text-3xl font-bold tracking-tight">Browse</h1>
      <SearchForm defaultValue={q} />
      <p id="search-summary" className="text-sm text-muted">
        {plural(matches.length, "card")}
        {shown.length > 0 ? ` · showing ${pageStart + 1}–${pageStart + shown.length}` : ""}
      </p>
      <section aria-labelledby="card-results-heading">
        <h2 id="card-results-heading" className="sr-only">
          Card results
        </h2>
        {shown.length === 0 && <p className="card p-4 text-sm text-muted">No cards found.</p>}
        <CardList cards={shown} decks={decks} showDeckNames />
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
