import CardRow from "@/components/CardRow";
import { listDecks, scanAllCards } from "@/lib/db";

export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "" } = await searchParams;
  const [decks, cards] = await Promise.all([listDecks(), scanAllCards()]);
  const deckName = new Map(decks.map((d) => [d.id, d.name]));
  const deckFrontLang = new Map(decks.map((d) => [d.id, d.frontLanguage]));

  const query = q.trim().toLowerCase();
  const matches = query
    ? cards.filter(
        (c) =>
          c.front.toLowerCase().includes(query) ||
          c.back.toLowerCase().includes(query) ||
          (c.notes ?? "").toLowerCase().includes(query)
      )
    : cards;
  const sorted = [...matches].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const shown = sorted.slice(0, 200);

  return (
    <div className="space-y-4 py-6">
      <h1 className="text-2xl font-bold">Browse</h1>
      <form method="GET" action="/browse">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search front, back, or notes…"
          className="w-full rounded-xl border border-border bg-surface px-4 py-3 outline-none focus:border-accent"
        />
      </form>
      <p className="text-sm text-muted">
        {matches.length} card{matches.length === 1 ? "" : "s"}
        {shown.length < matches.length ? ` (showing first ${shown.length})` : ""}
      </p>
      <div className="space-y-2">
        {shown.map((card) => (
          <div key={card.id}>
            <div className="mb-0.5 px-1 text-xs text-muted">
              {deckName.get(card.deckId) ?? "Unknown deck"}
            </div>
            <CardRow card={card} decks={decks} frontLang={deckFrontLang.get(card.deckId)} />
          </div>
        ))}
      </div>
    </div>
  );
}
