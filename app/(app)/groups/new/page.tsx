import Link from "next/link";
import PracticeGroupForm from "@/components/PracticeGroupForm";
import { listAllCards, listDecks } from "@/lib/db";
import { deckKicker } from "@/lib/deck-kicker";
import { requireLearnerPage } from "@/lib/guards";
import { lessonSections } from "@/lib/practice-groups";
import { uniqueWords } from "@/lib/words";

export default async function NewPracticeGroupPage() {
  await requireLearnerPage();
  const decks = await listDecks();
  const cards = uniqueWords(await listAllCards(decks));
  const counts = new Map<string, number>();
  for (const card of cards) counts.set(card.deckId, (counts.get(card.deckId) ?? 0) + 1);
  return (
    <div className="space-y-6 py-6">
      <header>
        <Link href="/" className="btn btn-ghost -ml-3 px-3">← Home</Link>
        <p className="eyebrow mt-2">Practice a group</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">New group</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          Combine lessons and study them together. Words that repeat across lessons appear once.
          Every rating counts toward your normal review schedule. Add an exam date to get a day-by-day plan.
        </p>
      </header>
      <PracticeGroupForm sections={lessonSections(decks, counts, deckKicker)} />
    </div>
  );
}
