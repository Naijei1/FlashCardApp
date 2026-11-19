import Chip from "@/components/Chip";
import CountChips from "@/components/CountChips";
import InfoButton from "@/components/InfoButton";
import Link from "next/link";
import AdminHome from "@/components/AdminHome";
import ModeLink from "@/components/ModeLink";
import NewDeckButton from "@/components/NewDeckButton";
import WarmStudyQueue from "@/components/WarmStudyQueue";
import WeeklyGoal from "@/components/WeeklyGoal";
import { reviewQueueUrl } from "@/components/studyQueueCache";
import { getAppSession } from "@/lib/app-session";
import { deckKicker } from "@/lib/deck-kicker";
import { listAllCards, listDecks, nextReleaseTeaser } from "@/lib/db";
import { mergeCramEntries } from "@/lib/cram";
import { summarizeGroup } from "@/lib/group-study";
import { listPracticeGroups } from "@/lib/practice-group-store";
import { resolveGroupDecks, type PracticeGroup } from "@/lib/practice-groups";
import { countsByDeck, totalCounts } from "@/lib/due";
import { weakWordCount } from "@/lib/mistake-clinic";
import { plural } from "@/lib/plural";
import { appTimeZone } from "@/lib/forecast";
import { partitionStudyDecks, releaseWeekLabel, type ReleaseTeaser } from "@/lib/multi-user-model";
import { newToday, weeklyProgress } from "@/lib/practice";
import { hardWords } from "@/lib/study-sets";
import type { Card, Deck, DeckCounts } from "@/lib/types";
import { uniqueWords } from "@/lib/words";

function DeckList({
  decks,
  byDeck,
  grouped,
}: {
  decks: Deck[];
  byDeck: Map<string, DeckCounts>;
  grouped: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
      {decks.map((deck) => {
        const counts = byDeck.get(deck.id) ?? { total: 0, due: 0, newCards: 0 };
        return (
          <ModeLink
            key={deck.id}
            href={`/decks/${deck.id}`}
            title={deck.name}
            kicker={grouped ? deckKicker(deck) : undefined}
            chips={<CountChips counts={counts} showTotal />}
          />
        );
      })}
    </div>
  );
}

function PracticeGroups({ groups, decks, cards, now, timeZone }: {
  groups: PracticeGroup[]; decks: Deck[]; cards: Card[]; now: Date; timeZone: string;
}) {
  return (
    <section aria-labelledby="groups-heading" className="space-y-3">
      <div className="flex items-center gap-1">
        <h2 id="groups-heading" className="eyebrow">Practice a group</h2>
        <InfoButton topic="Practice groups">Study several lessons together, for example to prepare for an exam. Ratings count toward your normal reviews.</InfoButton>
      </div>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
        {groups.map((group) => {
          const { decks: available, missing } = resolveGroupDecks(group, decks);
          const selected = new Set(available.map((deck) => deck.id));
          const entries = mergeCramEntries(cards.filter((card) => selected.has(card.deckId)), available);
          const { exam, modes } = summarizeGroup(entries, { group, decks: available, now, timeZone });
          const today = exam ? exam.due + exam.newToday
            : modes.review.due + modes.write.due + modes.review.newToday + modes.write.newToday;
          return (
            <ModeLink key={group.id} href={`/groups/${encodeURIComponent(group.id)}`} title={group.name}
              chips={<>
                {exam ? <>
                  <Chip tone="accent">{exam.daysLeft === 0 ? "Exam today" : `Exam in ${plural(exam.daysLeft, "day")}`}</Chip>
                  <Chip>{exam.total ? Math.round(100 * exam.ready / exam.total) : 0}% ready</Chip>
                </> : <Chip>{plural(available.length, "lesson")}</Chip>}
                <Chip>{today} today</Chip>
                {missing > 0 && <Chip tone="warning">{missing} unavailable</Chip>}
              </>} />
          );
        })}
        <Link href="/groups/new"
          className="pressable flex min-h-20 items-center justify-center rounded-2xl border border-dashed border-border px-5 py-4 text-sm font-semibold text-muted hover:border-accent/50 hover:text-foreground">
          + New practice group
        </Link>
      </div>
    </section>
  );
}

function UpcomingLesson({ teaser, timeZone }: { teaser: ReleaseTeaser; timeZone: string }) {
  const opens = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(teaser.releaseAt));
  const when = typeof teaser.releaseWeek === "number" ? `${releaseWeekLabel(teaser.releaseWeek)} · ${opens}` : opens;
  return (
    <section aria-labelledby="upcoming-heading" className="card p-5">
      <h2 id="upcoming-heading" className="eyebrow">Coming up</h2>
      <p className="mt-2 font-semibold">{teaser.name}</p>
      <p className="mt-1 text-sm text-muted">Opens {when}. Cards stay hidden until then.</p>
    </section>
  );
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ adminStudy?: string }>;
}) {
  const { adminStudy } = await searchParams;
  if ((await getAppSession())?.role === "admin") {
    return <AdminHome studyBlocked={adminStudy === "1"} />;
  }
  const [decks, teaser, practiceGroups] = await Promise.all([listDecks(), nextReleaseTeaser(), listPracticeGroups()]);
  // A review commits just before this page is shown again. A consistent read
  // sees that write; an eventually consistent one keeps the old due counts.
  const cards = await listAllCards(decks, { consistent: true });
  const now = new Date();
  const totals = totalCounts(cards, now);
  const byDeck = countsByDeck(cards, now);
  const groups = partitionStudyDecks(decks);
  const zone = appTimeZone();
  const hardCount = uniqueWords(hardWords(cards)).length;
  const clinicCount = weakWordCount(cards, { now });
  const progress = weeklyProgress(cards, now, zone);
  const allowance = newToday(totals.newCards, cards, now, zone);
  const canStudy = totals.due + totals.newCards > 0;

  return (
    <div className="space-y-8 py-6">
      {canStudy && <WarmStudyQueue url={reviewQueueUrl("all", "review")} />}
      <header>
        <p className="eyebrow">学中文</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Chinese Flashcards</h1>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5 lg:items-stretch">
        <section className="card flex flex-col overflow-hidden lg:col-span-3">
          <div className="flex-1 p-5 sm:p-6">
            <div className="flex items-center gap-1">
              <h2 className="eyebrow">Today</h2>
              <InfoButton topic="Today">Spaced Repetition is the daily default. It mixes due reviews with a small number of new words.</InfoButton>
            </div>
            <div className="mt-3 flex items-end gap-8">
              <div>
                <div className="text-5xl font-bold tracking-tight text-accent tabular-nums">{totals.due}</div>
                <div className="mt-1 text-sm text-muted">reviews due</div>
              </div>
              <div>
                <div className="text-5xl font-bold tracking-tight tabular-nums">{allowance}</div>
                <div className="mt-1 text-sm text-muted">new today</div>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-2 border-t border-border bg-surface-muted/50 p-4 sm:flex-row">
            {canStudy ? (
              <Link href="/review/all" prefetch className="btn btn-primary btn-lg flex-1">Start Review</Link>
            ) : (
              <span aria-disabled="true" className="btn btn-secondary btn-lg flex-1 text-muted">Nothing due</span>
            )}
            <Link href="/decks/all" className="btn btn-secondary btn-lg flex-1 text-base">All study modes</Link>
          </div>
        </section>
        <div className="lg:col-span-2"><WeeklyGoal initialProgress={progress} /></div>
      </div>

      <section aria-label="Weak words" className="card overflow-hidden">
        <ModeLink href="/clinic" prefetch unframed title="Weak words"
          detail={clinicCount > 0 ? `${plural(clinicCount, "weak word")} to drill` : "Misses and starred words show up here"}
          badge={clinicCount} />
        {hardCount > 0 && (
          <Link href="/decks/hard-words" className="mx-5 mb-2 inline-flex min-h-11 items-center rounded-full hover:brightness-95">
            <Chip tone="warning">★ {hardCount} starred</Chip>
          </Link>
        )}
      </section>

      <PracticeGroups groups={practiceGroups} decks={decks} cards={cards} now={now} timeZone={zone} />

      {teaser && <UpcomingLesson teaser={teaser} timeZone={zone} />}

      {groups ? (
        <>
          <section aria-labelledby="shared-heading" className="space-y-3">
            <h2 id="shared-heading" className="eyebrow">Shared lessons</h2>
            {groups.shared.length === 0 ? (
              <p className="card p-4 text-sm text-muted">No shared lessons are available yet.</p>
            ) : (
              <DeckList decks={groups.shared} byDeck={byDeck} grouped />
            )}
          </section>
          <section aria-labelledby="personal-heading" className="space-y-3">
            <h2 id="personal-heading" className="eyebrow">Your decks</h2>
            {groups.personal.length === 0 ? (
              <p className="text-sm text-muted">Private decks you create stay in this list. Shared lessons stay above.</p>
            ) : (
              <DeckList decks={groups.personal} byDeck={byDeck} grouped />
            )}
            <div className="flex flex-wrap items-start gap-2">
              <div className="min-w-0 flex-1"><NewDeckButton /></div>
              <Link href="/import" className="btn btn-secondary">Import CSV</Link>
            </div>
          </section>
        </>
      ) : (
        <section aria-labelledby="decks-heading" className="space-y-3">
          <h2 id="decks-heading" className="eyebrow">Decks</h2>
          {decks.length === 0 && (
            <div className="card space-y-3 p-5">
              <div>
                <h3 className="font-semibold">Start with one small lesson deck</h3>
                <p className="mt-1 text-sm text-muted">
                  Create a deck, add a few words, then tap Start Review. You can import a CSV later when you have a larger list.
                </p>
              </div>
              <ol className="grid gap-2 text-sm text-muted sm:grid-cols-3">
                <li><span className="font-semibold text-foreground">1.</span> Create a deck</li>
                <li><span className="font-semibold text-foreground">2.</span> Add or import cards</li>
                <li><span className="font-semibold text-foreground">3.</span> Review daily</li>
              </ol>
            </div>
          )}
          <DeckList decks={decks} byDeck={byDeck} grouped={false} />
          <div className="flex flex-wrap items-start gap-2">
            <div className="min-w-0 flex-1"><NewDeckButton /></div>
            <Link href="/import" className="btn btn-secondary">Import CSV</Link>
          </div>
        </section>
      )}
    </div>
  );
}
