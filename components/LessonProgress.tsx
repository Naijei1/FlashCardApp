import InfoButton from "@/components/InfoButton";
import { EXAM_MODES, type ExamMode } from "@/lib/exam";
import { ATTRIBUTION_NOTE, HISTORY_WINDOW, recentStruggle, SKILL_NAMES, type PracticeSession, type Readiness } from "@/lib/lesson-stats";
import { plural } from "@/lib/plural";
import { readinessColors, StatsBar, StatsLegend, StrugglePill } from "./LessonStatsBar";

export default function LessonProgress({ lessons, history, target }: {
  lessons: { id: string; name: string; kicker?: string; readiness: Record<ExamMode, Readiness> }[];
  history: PracticeSession[]; target: number;
}) {
  return (
    <section className="card overflow-hidden">
      <header className="space-y-3 border-b border-border px-4 py-4 sm:px-5">
        <div className="flex items-center gap-1">
          <h2 className="font-semibold">Lesson progress</h2>
          <InfoButton topic="Lesson progress">
            <p>The fraction shows solid words out of all words. Solid words have finished learning and meet your {target}% recall target today. Shaky words are learning, relearning, or below target.</p>
            <p>Struggle is the share of Again and Hard ratings over the last {HISTORY_WINDOW} sessions per skill. Arrows compare the latest session with the earlier ratings combined.</p>
            <p>{ATTRIBUTION_NOTE}</p>
          </InfoButton>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <StatsLegend colors={readinessColors} />
          <span className="text-xs font-medium text-muted">Struggle</span>
        </div>
      </header>
      <ul className="divide-y divide-border" role="list">
        {lessons.map(({ id, name, kicker, readiness }) => (
          <li key={id} className="space-y-2 px-4 py-3 sm:px-5">
            <h3 className="font-semibold break-words">{name} {kicker && <small className="font-normal text-muted">{kicker}</small>}</h3>
            {EXAM_MODES.map((mode) => {
              const skill = SKILL_NAMES[mode];
              const { rate, change, latestRate, sessionCount } = recentStruggle(history, id, mode);
              const { solid, shaky, unseen } = readiness[mode];
              const total = solid + shaky + unseen;
              let context = `over the last ${plural(sessionCount, "session")}`;
              if (latestRate !== null && change) context += `. Latest session ${Math.round(latestRate * 100)}%, ${change.description}`;
              return <div key={mode} className="grid grid-cols-[5rem_minmax(0,1fr)_auto_3.75rem] items-center gap-2 text-xs sm:gap-3">
                <span className="text-muted">{skill}</span>
                <StatsBar name={skill} colors={readinessColors} counts={{ Solid: solid, Shaky: shaky, Unseen: unseen }} />
                <span className="min-w-10 text-right whitespace-nowrap text-muted tabular-nums" title={`${solid} of ${total} words solid`}>
                  {total ? `${solid}/${total}` : "No words"}
                </span>
                <StrugglePill rate={rate} context={context} arrow={change?.arrow} />
              </div>;
            })}
          </li>
        ))}
      </ul>
      {!lessons.length && <p className="px-5 py-4 text-sm text-muted">No lessons available. Edit the group to pick some.</p>}
    </section>
  );
}
