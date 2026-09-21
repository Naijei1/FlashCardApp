import { chineseSideForCard, chineseSideForDeck } from "@/lib/write";
import { readingForCard } from "@/lib/pinyin-queue";
import { cardForMode } from "@/lib/modes";
import { studyCards, studyDeck, HARD_DECK } from "@/lib/hard-words";
import Link from "next/link";
import { notFound } from "next/navigation";
import AddCardForm from "@/components/AddCardForm";
import CardPagination from "@/components/CardPagination";
import { IconChevronRight } from "@/components/icons";
import CardRow from "@/components/CardRow";
import DeckSettings from "@/components/DeckSettings";
import { listDecks } from "@/lib/db";
import { uniqueWords } from "@/lib/words";
import { appTimeZone } from "@/lib/forecast";
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
    studyDeck(deckId),
    studyCards(deckId),
    listDecks(),
  ]);
  if (!deck) notFound();
  const now = new Date();
  const counts = totalCounts(cards, now);
  const side = chineseSideForDeck(deck);
  const writeCounts = totalCounts(cards.filter((c) => chineseSideForCard(c, side) !== null).map((c) => cardForMode(c, "write")), now);
  const pinyinCounts = totalCounts(cards.filter((c) => readingForCard(c, side) !== null).map((c) => cardForMode(c, "pinyin")), now);
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
  const shownFrom = shown.length > 0 ? pageStart + 1 : 0;
  const shownTo = pageStart + shown.length;

  return (
    <div className="space-y-6 py-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-bold">{deck.name}</h1>
          <p className="text-sm text-muted">
            {counts.total} card{counts.total === 1 ? "" : "s"} · {counts.due} due words ·{" "}
            {counts.newCards} new words
          </p>
        </div>
        {deckId !== HARD_DECK && <DeckSettings deck={deck} />}
      </div>

      {words.length > 0 && counts.newCards === 0 && (
        <p className="rounded-xl border border-border bg-surface p-4 text-sm text-muted">
          All {words.length} words have been studied in Spaced Repetition. Writing and pinyin have separate schedules.
          {counts.due === 0 && nextReview ? ` Next scheduled review: ${nextReview}.` : ""}
          {" "}Use Normal Review to practice anytime without changing your schedule.
        </p>
      )}

      <p className="text-sm text-muted">Each mode has its own queue and review history. Schedules target 95% recall; missed words return sooner.</p>
      <div className="space-y-2">
        <Link
          href={`/review/${deck.id}`}
          className="pressable flex items-center justify-between rounded-2xl bg-accent px-5 py-4 text-accent-foreground"
        >
          <span>
            <span className="block text-lg font-semibold">Spaced Repetition</span>
            <span className="block text-sm opacity-80">
              {counts.due > 0
                ? `Review ${counts.due} due word${counts.due === 1 ? "" : "s"}`
                : "Nothing due right now"}
            </span>
          </span>
          <IconChevronRight className="text-xl opacity-70" />
        </Link>
        {counts.newCards > 0 && (
          <Link href={`/review/${deck.id}?new=1`} prefetch={false}
            className="pressable flex items-center justify-between rounded-2xl border border-accent/40 bg-surface px-5 py-4">
            <span>
              <span className="block text-lg font-semibold">Learn new words</span>
              <span className="block text-sm text-muted">Start with {counts.newCards} unseen words in this deck</span>
            </span>
            <IconChevronRight className="text-xl text-muted" />
          </Link>
        )}
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
              {writeCounts.due} due · {writeCounts.newCards} new in Chinese writing
            </span>
          </span>
          <IconChevronRight className="text-xl text-muted" />
        </Link>
        <Link
          href={`/pinyin/${deck.id}`}
          className="pressable flex items-center justify-between rounded-2xl border border-border bg-surface px-5 py-4"
        >
          <span>
            <span className="block text-lg font-semibold">Write Pinyin</span>
            <span className="block text-sm text-muted">
              {pinyinCounts.due} due · {pinyinCounts.newCards} new in pinyin
            </span>
          </span>
          <IconChevronRight className="text-xl text-muted" />
        </Link>
      </div>

      {deckId !== HARD_DECK && <div className="flex gap-4 px-1 text-sm">
        <Link href={`/import?deck=${deck.id}`} className="text-accent">
          Import CSV
        </Link>
        <a href={`/api/decks/${deck.id}/export`} className="text-accent">
          Export CSV
        </a>
      </div>}

      {deckId !== HARD_DECK && <AddCardForm deckId={deck.id} />}

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
          <p className="text-sm text-muted">{deckId === HARD_DECK ? "No hard words yet. Use Mark as hard while studying or in a lesson’s card list." : "No cards yet — add one above or import a CSV."}</p>
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
