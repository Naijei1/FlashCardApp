import { EXAM_MODES, type ExamMode } from "@/lib/exam";
import { ATTRIBUTION_NOTE, HISTORY_WINDOW, recentStruggle, SKILL_NAMES, type PracticeSession, type Readiness } from "@/lib/lesson-stats";
import { plural } from "@/lib/plural";

export default function LessonProgress({ lessons, history, target }: {
  lessons: { id: string; name: string; kicker?: string; readiness: Record<ExamMode, Readiness> }[];
  history: PracticeSession[]; target: number;
}) {
  return (
    <section className="card overflow-hidden">
      <div className="space-y-1 px-5 pt-4">
        <h2 className="eyebrow">Lesson progress</h2>
        <p className="text-sm text-muted">Struggle is the share of Retry (Again) and Hard ratings in this group’s last {HISTORY_WINDOW} sessions per skill.
          Trends run oldest to newest. A dash means the lesson had no ratings that session.</p>
        <p className="text-sm text-muted">Solid words have finished learning and meet your {target}% recall target today.
          Shaky words are learning, relearning, or below target. {ATTRIBUTION_NOTE}</p>
      </div>
      <ul className="divide-y divide-border" role="list">
        {lessons.map(({ id, name, kicker, readiness }) => (
          <li key={id} className="space-y-2 px-5 py-4">
            <h3 className="font-semibold break-words">{name} {kicker && <small className="font-normal text-muted">{kicker}</small>}</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {EXAM_MODES.map((mode) => {
                const { rate, trend, ratings } = recentStruggle(history, id, mode);
                const { shaky, solid, unseen } = readiness[mode];
                return (
                  <div key={mode} className="text-sm tabular-nums">
                    <h4 className="font-medium">{SKILL_NAMES[mode]}</h4>
                    <p>{rate === null ? "No recent ratings" : `${Math.round(rate * 100)}% struggle · ${plural(ratings, "rating")}`}</p>
                    <p className="text-muted">{shaky} shaky · {solid} solid · {unseen} unseen</p>
                    {trend.length > 0 && <ol role="list" aria-label={`${SKILL_NAMES[mode]} struggle, oldest to newest`} className="mt-2 flex gap-1">
                      {trend.map((value, i) => <li key={i} className="flex w-9 flex-col justify-end text-center text-xs text-muted">
                        <span aria-hidden="true" className="mx-auto w-3 rounded-t bg-accent" style={{ height: value === null ? 0 : 2 + value * 20 }} />
                        {value === null ? <><span aria-hidden="true">—</span><span className="sr-only">No ratings</span></> : `${Math.round(value * 100)}%`}
                      </li>)}
                    </ol>}
                  </div>
                );
              })}
            </div>
          </li>
        ))}
      </ul>
      {!lessons.length && <p className="px-5 py-4 text-sm text-muted">No lessons available. Edit the group to pick some.</p>}
    </section>
  );
}
