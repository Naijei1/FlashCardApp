import Link from "next/link";
import { notFound } from "next/navigation";
import LessonProgress from "@/components/LessonProgress";
import { EXAM_MODES } from "@/lib/exam";
import { recentPracticeSessions } from "@/lib/practice-group-store";
import GroupEditor from "@/components/GroupEditor";
import { loadCramSet } from "@/lib/cram-set";
import { deckKicker } from "@/lib/deck-kicker";
import { appTimeZone } from "@/lib/forecast";
import { requireLearnerPage } from "@/lib/guards";
import { listAllCards, listDecks } from "@/lib/db";
import { examTileLine, lessonReadiness, summarizeGroup, type ModeSummary } from "@/lib/group-study";
import { groupTargetRecall, lessonSections, type GroupPlan } from "@/lib/practice-groups";
import { plural } from "@/lib/plural";
import type { ReviewMode } from "@/lib/types";
import { uniqueWords } from "@/lib/words";

const MODE_LABELS: Record<ReviewMode, string> = { review: "Recognition", write: "Writing", pinyin: "Pinyin" };

function formatExamDate(examDate: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric" })
    .format(new Date(`${examDate}T12:00:00Z`));
}

function StudyRow({ groupId, mode, plan, summary, label }: {
  groupId: string; mode: ReviewMode; plan: GroupPlan; summary: ModeSummary; label?: string;
}) {
  const href = `/cram/${encodeURIComponent(groupId)}?mode=${mode}&plan=${plan}`;
  const count = plan === "all" ? summary.total : summary.due + summary.newToday;
  const detail = plan === "all"
    ? plural(summary.total, "card")
    : `${summary.due} due + ${summary.newToday} new`;
  return (
    <li className="flex items-center justify-between gap-3 px-5 py-3">
      <div className="min-w-0">
        <p className="font-medium">{label ?? MODE_LABELS[mode]}</p>
        <p className="text-sm text-muted tabular-nums">{detail}</p>
      </div>
      {count > 0 ? (
        <Link href={href} className={`btn shrink-0 ${plan === "today" ? "btn-primary" : "btn-secondary"}`}>Start</Link>
      ) : (
        <span aria-disabled="true" className="btn btn-secondary shrink-0 text-muted">{plan === "all" ? "No cards" : "Done"}</span>
      )}
    </li>
  );
}

export default async function PracticeGroupPage({ params }: { params: Promise<{ groupId: string }> }) {
  await requireLearnerPage();
  const { groupId } = await params;
  const decks = await listDecks();
  const allCards = await listAllCards(decks, { consistent: true });
  const set = await loadCramSet(groupId, { decks, cards: allCards });
  if (!set) notFound();
  const { group, missing } = set;
  const counts = new Map<string, number>();
  for (const card of uniqueWords(allCards)) {
    counts.set(card.deckId, (counts.get(card.deckId) ?? 0) + 1);
  }
  const ctx = { group, decks: set.decks, now: new Date(), timeZone: appTimeZone() };
  const summary = summarizeGroup(set.entries, ctx);
  const readiness = lessonReadiness(set.entries, ctx);
  const history = await Promise.all(EXAM_MODES.map((mode) => recentPracticeSessions(group.id, mode)));
  const { exam } = summary;
  const target = Math.round(groupTargetRecall(group) * 100);

  return (
    <div className="space-y-6 py-6">
      <header>
        <Link href="/" className="btn btn-ghost -ml-3 px-3">← Home</Link>
        <p className="eyebrow mt-2">Practice group{exam ? " · exam prep" : ""}</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight break-words">{group.name}</h1>
        <p className="mt-2 text-sm text-muted">
          {plural(set.entries.length, "word")} from {plural(set.decks.length, "lesson")}. Words repeated across lessons appear once.
          Every rating counts toward your normal review schedule.
        </p>
      </header>

      {missing > 0 && (
        <p role="status" className="card border-amber-500/40 p-4 text-sm">
          {missing === 1 ? "1 lesson in this group is" : `${missing} lessons in this group are`} no longer available
          and {missing === 1 ? "was" : "were"} skipped. Edit the group to tidy it up.
        </p>
      )}

      {exam && (
        <section aria-labelledby="exam-heading" className="card p-5">
          <h2 id="exam-heading" className="eyebrow">Exam plan</h2>
          <p className="mt-2 text-lg font-semibold">{examTileLine(exam)}</p>
          <p className="mt-1 text-sm text-muted">
            Exam on {formatExamDate(exam.examDate)} · aiming for {target}% recall in recognition and writing.
            {exam.finalPass ? " Final pass: anything below 97% predicted recall is due today." : ""}
          </p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-border/70" aria-hidden="true">
            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${exam.total ? (exam.ready / exam.total) * 100 : 0}%` }} />
          </div>
        </section>
      )}

      <section aria-labelledby="today-heading" className="card overflow-hidden">
        <h2 id="today-heading" className="eyebrow px-5 pt-4">{exam ? "Today’s exam plan" : "Today"}</h2>
        <ul className="divide-y divide-border">
          <StudyRow groupId={group.id} mode="review" plan="today" summary={summary.modes.review} />
          <StudyRow groupId={group.id} mode="write" plan="today" summary={summary.modes.write} />
        </ul>
      </section>

      <section aria-labelledby="practice-heading" className="card overflow-hidden">
        <div className="px-5 pt-4">
          <h2 id="practice-heading" className="eyebrow">Extra practice</h2>
          <p className="mt-1 text-sm text-muted">These also save to your review schedule.{exam ? " Pinyin doesn’t count toward exam readiness." : ""}</p>
        </div>
        <ul className="divide-y divide-border">
          <StudyRow groupId={group.id} mode="review" plan="all" summary={summary.modes.review} label="Shuffle all · Recognition" />
          <StudyRow groupId={group.id} mode="write" plan="all" summary={summary.modes.write} label="Shuffle all · Writing" />
          <StudyRow groupId={group.id} mode="pinyin" plan="today" summary={summary.modes.pinyin} label="Pinyin practice" />
        </ul>
      </section>

      <LessonProgress lessons={set.decks.map((d) => ({ id: d.id, name: d.name, kicker: d.source ? deckKicker(d) : undefined,
        readiness: readiness.get(d.id)! }))} target={target} history={history.flat()} />

      <GroupEditor sections={lessonSections(decks, counts, deckKicker)}
        group={{ id: group.id, name: group.name, deckIds: group.deckIds, examDate: group.examDate, targetRecall: group.targetRecall }} />
    </div>
  );
}
