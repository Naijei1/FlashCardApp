import Link from "next/link";
import { notFound } from "next/navigation";
import AddCardForm from "@/components/AddCardForm";
import CardList from "@/components/CardList";
import CardPagination from "@/components/CardPagination";
import DeckSettings from "@/components/DeckSettings";
import ModeLink from "@/components/ModeLink";
import { listDecks } from "@/lib/db";
import { totalCounts } from "@/lib/due";
import { appTimeZone } from "@/lib/forecast";
import { cardForMode } from "@/lib/modes";
import { studyDetails } from "@/lib/pinyin-queue";
import { plural } from "@/lib/plural";
import { DAILY_WORD_GOAL } from "@/lib/practice";
import { ALL_DECK, HARD_DECK, isVirtualDeck, loadStudySet } from "@/lib/study-sets";
import type { ReviewMode } from "@/lib/types";
import { uniqueWords } from "@/lib/words";

const PAGE_SIZE = 50;

function requestedPage(value: string | undefined): number {
  const page = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

const EYEBROW: Record<string, string> = {
  [ALL_DECK]: "Global study · every deck",
  [HARD_DECK]: "Filtered deck",
};

export default async function DeckPage({
  params,
  searchParams,
}: {
  params: Promise<{ deckId: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const [{ deckId }, { page: pageParam }] = await Promise.all([params, searchParams]);
  const preloadedDecks = isVirtualDeck(deckId) ? await listDecks() : undefined;
  const [set, decks] = await Promise.all([
    loadStudySet(deckId, preloadedDecks),
    preloadedDecks ? Promise.resolve(preloadedDecks) : listDecks(),
  ]);
  if (!set) notFound();
  const { deck, cards, sideFor } = set;
  const virtual = isVirtualDeck(deckId);
  const now = new Date();
  const skillCounts = (mode: ReviewMode) => totalCounts(
    cards.map((card) => cardForMode(card, mode)).filter((card) => studyDetails(card, mode, sideFor(card))),
    now
  );
  const counts = totalCounts(cards, now);
  const writeCounts = skillCounts("write");
  const pinyinCounts = skillCounts("pinyin");
  const words = uniqueWords(cards);
  const upcoming = words.map((card) => new Date(card.fsrs.due))
    .filter((due) => due > now).sort((a, b) => a.getTime() - b.getTime())[0];
  const nextReview = upcoming ? new Intl.DateTimeFormat("en-US", {
    timeZone: appTimeZone(), month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).format(upcoming) : null;

  const sorted = [...cards].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const page = Math.min(requestedPage(pageParam), totalPages);
  const pageStart = (page - 1) * PAGE_SIZE;
  const shown = sorted.slice(pageStart, pageStart + PAGE_SIZE);
  const status = (due: number, fresh: number) =>
    [due > 0 ? `${due} due` : "Nothing due", fresh > 0 ? `${fresh} new` : ""].filter(Boolean).join(" · ");

  return (
    <div className="space-y-8 py-6">
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="eyebrow">{EYEBROW[deckId] ?? "Lesson"}</p>
          <h1 className="mt-1 truncate text-3xl font-bold tracking-tight">{deck.name}</h1>
          <p className="mt-1 text-sm text-muted">
            {plural(counts.total, "card")} · {counts.due} due · {counts.newCards} new
            {deckId === ALL_DECK && ` · ${plural(decks.length, "deck")}`}
          </p>
        </div>
        {!virtual && <DeckSettings deck={deck} />}
      </header>

      <section aria-labelledby="modes-heading" className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="modes-heading" className="eyebrow">Study modes</h2>
          <span className="text-xs text-muted">Each mode keeps its own schedule</span>
        </div>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
          <div className="sm:col-span-2 xl:col-span-4">
            <ModeLink primary href={`/review/${deckId}`} title="Spaced Repetition"
              detail={`${status(counts.due, counts.newCards)} · up to ${DAILY_WORD_GOAL} new a day`}
              badge={counts.due} />
          </div>
          {counts.newCards > 0 && (
            <ModeLink href={`/review/${deckId}?new=1`} title="Learn new words"
              detail={`Start ${plural(counts.newCards, "unseen word")}`} />
          )}
          <ModeLink href={`/study/${deckId}`} title="Normal Review"
            detail="Flip freely — doesn’t affect scheduling" />
          <ModeLink href={`/write/${deckId}`} title="Write Chinese"
            detail={`Pinyin → characters · ${status(writeCounts.due, writeCounts.newCards)}`}
            badge={writeCounts.due} />
          <ModeLink href={`/pinyin/${deckId}`} title="Write Pinyin"
            detail={`Characters → pinyin · ${status(pinyinCounts.due, pinyinCounts.newCards)}`}
            badge={pinyinCounts.due} />
        </div>
        {words.length > 0 && counts.newCards === 0 && counts.due === 0 && nextReview && (
          <p className="text-sm text-muted">
            All caught up in Spaced Repetition. Next scheduled review: {nextReview}.
          </p>
        )}
      </section>

      {!virtual && (
        <>
          <div className="flex gap-2">
            <Link href={`/import?deck=${deck.id}`} className="btn btn-secondary">Import CSV</Link>
            <a href={`/api/decks/${deck.id}/export`} className="btn btn-secondary">Export CSV</a>
          </div>
          <AddCardForm deckId={deck.id} />
        </>
      )}

      <section aria-labelledby="deck-cards-heading" className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="deck-cards-heading" className="eyebrow">Cards</h2>
          {shown.length > 0 && (
            <span className="text-xs tabular-nums text-muted">
              Showing {pageStart + 1}–{pageStart + shown.length} of {sorted.length}
            </span>
          )}
        </div>
        {sorted.length === 0 && (
          <p className="card p-4 text-sm text-muted">
            {deckId === HARD_DECK
              ? "No hard words yet. Use Mark as hard while studying or in a lesson’s card list."
              : virtual ? "No cards yet — create a deck and add some words." : "No cards yet — add one above or import a CSV."}
          </p>
        )}
        <CardList cards={shown} decks={decks} showDeckNames={virtual} />
        <CardPagination basePath={`/decks/${deck.id}`} currentPage={page} totalPages={totalPages} />
      </section>
    </div>
  );
}
