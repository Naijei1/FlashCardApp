import Link from "next/link";
import { notFound } from "next/navigation";
import GroupEditor from "@/components/GroupEditor";
import { loadCramSet } from "@/lib/cram-set";
import { deckKicker } from "@/lib/deck-kicker";
import { requireLearnerPage } from "@/lib/guards";
import { listAllCards, listDecks } from "@/lib/db";
import { lessonSections } from "@/lib/practice-groups";
import { plural } from "@/lib/plural";
import { uniqueWords } from "@/lib/words";

export default async function PracticeGroupPage({ params }: { params: Promise<{ groupId: string }> }) {
  await requireLearnerPage();
  const { groupId } = await params;
  const decks = await listDecks();
  const allCards = await listAllCards(decks);
  const set = await loadCramSet(groupId, { decks, cards: allCards });
  if (!set) notFound();
  const { group, missing } = set;
  const counts = new Map<string, number>();
  for (const card of uniqueWords(allCards)) {
    counts.set(card.deckId, (counts.get(card.deckId) ?? 0) + 1);
  }
  const href = `/cram/${encodeURIComponent(group.id)}`;

  return (
    <div className="space-y-6 py-6">
      <header>
        <Link href="/" className="btn btn-ghost -ml-3 px-3">← Home</Link>
        <p className="eyebrow mt-2">Practice group · cram mode</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight break-words">{group.name}</h1>
        <p className="mt-2 text-sm text-muted">
          {plural(set.cards.length, "card")} from {plural(set.decks.length, "lesson")}, shuffled every time.
          Cramming doesn&apos;t change your review schedule.
        </p>
      </header>

      {missing > 0 && (
        <p role="status" className="card border-amber-500/40 p-4 text-sm">
          {missing === 1 ? "1 lesson in this group is" : `${missing} lessons in this group are`} no longer available
          and {missing === 1 ? "was" : "were"} skipped. Edit the group to tidy it up.
        </p>
      )}

      <section className="card overflow-hidden">
        <ul className="divide-y divide-border">
          {set.decks.map((deck) => (
            <li key={deck.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
              <span className="min-w-0 truncate font-medium">{deck.name}</span>
              {deck.source && <span className="shrink-0 text-muted">{deckKicker(deck)}</span>}
            </li>
          ))}
          {set.decks.length === 0 && <li className="px-5 py-4 text-sm text-muted">No lessons available. Edit the group to pick some.</li>}
        </ul>
        <div className="border-t border-border bg-surface-muted/50 p-4">
          {set.cards.length > 0 ? (
            <Link href={href} className="btn btn-primary btn-lg w-full">Start cramming</Link>
          ) : (
            <span aria-disabled="true" className="btn btn-secondary btn-lg w-full text-muted">No cards to practice</span>
          )}
        </div>
      </section>

      <GroupEditor sections={lessonSections(decks, counts, deckKicker)}
        group={{ id: group.id, name: group.name, deckIds: group.deckIds }} />
    </div>
  );
}
