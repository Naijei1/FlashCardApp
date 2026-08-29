import { countReviewLogs, listDecks, scanAllCards } from "@/lib/db";
import { countsByDeck, totalCounts } from "@/lib/due";
import { State } from "ts-fsrs";

const STATE_LABELS: Record<number, string> = {
  [State.New]: "New",
  [State.Learning]: "Learning",
  [State.Review]: "Review",
  [State.Relearning]: "Relearning",
};

export default async function StatsPage() {
  const [decks, cards, reviewCount] = await Promise.all([
    listDecks(),
    scanAllCards(),
    countReviewLogs(),
  ]);
  const now = new Date();
  const totals = totalCounts(cards, now);
  const byDeck = countsByDeck(cards, now);

  const byState = new Map<number, number>();
  for (const card of cards) {
    byState.set(card.fsrs.state, (byState.get(card.fsrs.state) ?? 0) + 1);
  }

  const in7Days = cards.filter((c) => {
    const due = new Date(c.fsrs.due).getTime();
    return due > now.getTime() && due <= now.getTime() + 7 * 86_400_000;
  }).length;

  return (
    <div className="space-y-6 py-6">
      <h1 className="text-2xl font-bold">Stats</h1>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Total cards" value={totals.total} />
        <Stat label="Due now" value={totals.due} />
        <Stat label="Due next 7 days" value={in7Days} />
        <Stat label="Reviews logged" value={reviewCount} />
      </section>

      <section className="rounded-2xl border border-border bg-surface p-4">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted">
          Cards by state
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Object.entries(STATE_LABELS).map(([state, label]) => (
            <div key={state}>
              <div className="text-2xl font-bold">{byState.get(Number(state)) ?? 0}</div>
              <div className="text-sm text-muted">{label}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-surface p-4">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted">
          Per deck
        </h2>
        <div className="space-y-2 text-sm">
          {decks.map((deck) => {
            const counts = byDeck.get(deck.id) ?? { total: 0, due: 0, newCards: 0 };
            return (
              <div key={deck.id} className="flex justify-between border-b border-border pb-2 last:border-0">
                <span>{deck.name}</span>
                <span className="text-muted">
                  {counts.total} cards · {counts.due} due · {counts.newCards} new
                </span>
              </div>
            );
          })}
          {decks.length === 0 && <p className="text-muted">No decks yet.</p>}
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="text-3xl font-bold">{value}</div>
      <div className="text-sm text-muted">{label}</div>
    </div>
  );
}
