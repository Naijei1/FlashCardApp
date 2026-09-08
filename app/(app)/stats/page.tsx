import { countReviewLogs, listAllCards, listDecks } from "@/lib/db";
import { countsByDeck, totalCounts } from "@/lib/due";
import { formatInterval } from "@/lib/interval-label";
import { appTimeZone, buildReviewForecast } from "@/lib/forecast";
import { State } from "ts-fsrs";

const STATE_LABELS: Record<number, string> = {
  [State.New]: "New",
  [State.Learning]: "Learning",
  [State.Review]: "Review",
  [State.Relearning]: "Relearning",
};

export default async function StatsPage() {
  const [decks, reviewCount] = await Promise.all([listDecks(), countReviewLogs()]);
  const cards = await listAllCards(decks);
  const now = new Date();
  const totals = totalCounts(cards, now);
  const byDeck = countsByDeck(cards, now);

  const byState = new Map<number, number>();
  for (const card of cards) {
    byState.set(card.fsrs.state, (byState.get(card.fsrs.state) ?? 0) + 1);
  }

  const { days: forecast, upcomingCount: in7Days } = buildReviewForecast(
    cards.map((card) => new Date(card.fsrs.due)),
    now,
    appTimeZone()
  );
  const maxForecast = Math.max(1, ...forecast.map((f) => f.count));

  // The soonest upcoming (not-yet-due) cards, with time until their review.
  const deckNames = new Map(decks.map((d) => [d.id, d.name]));
  const upcoming = cards
    .filter((c) => new Date(c.fsrs.due).getTime() > now.getTime())
    .sort((a, b) => new Date(a.fsrs.due).getTime() - new Date(b.fsrs.due).getTime())
    .slice(0, 15);

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
          Review forecast — next 7 days
        </h2>
        <div className="space-y-1.5">
          {forecast.map((day) => (
            <div key={day.key} className="flex items-center gap-3 text-sm">
              <span className="w-24 shrink-0 text-muted">{day.label}</span>
              <div className="h-4 flex-1 overflow-hidden rounded bg-border/40">
                <div
                  className="h-full rounded bg-accent/70"
                  style={{ width: `${(day.count / maxForecast) * 100}%` }}
                />
              </div>
              <span className="w-8 shrink-0 text-right tabular-nums">{day.count}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-surface p-4">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted">
          Next reviews
        </h2>
        {upcoming.length === 0 ? (
          <p className="text-sm text-muted">
            No scheduled reviews yet — everything is either due now or unreviewed.
          </p>
        ) : (
          <div className="space-y-2 text-sm">
            {upcoming.map((card) => (
              <div
                key={card.id}
                className="flex items-baseline justify-between gap-3 border-b border-border pb-2 last:border-0 last:pb-0"
              >
                <span className="min-w-0 truncate">
                  {card.front} <span className="text-muted">→ {card.back}</span>
                </span>
                <span className="shrink-0 text-right text-muted">
                  in {formatInterval(new Date(card.fsrs.due).getTime() - now.getTime())}
                  <span className="hidden sm:inline"> · {deckNames.get(card.deckId) ?? ""}</span>
                </span>
              </div>
            ))}
          </div>
        )}
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
