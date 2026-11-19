import { describeChange, ratingCount, SKILL_NAMES, struggleRate, type PracticeSession } from "@/lib/lesson-stats";
import { plural } from "@/lib/plural";
import { ratingColors, StatsBar, StatsLegend, StrugglePill } from "./LessonStatsBar";

export default function LessonSessionSummary({ session, previous, lessonNames, saveState, onRetry }: {
  session: PracticeSession;
  previous?: PracticeSession;
  lessonNames: Record<string, string>;
  saveState: "saving" | "saved" | "failed";
  onRetry: () => void;
}) {
  const unrated = Object.entries(lessonNames).filter(([id]) => !session.lessons[id]);
  return <section className="card w-full px-4 text-left text-sm">
    <header className="space-y-2 border-b border-border py-3">
      <h2 className="font-semibold">{session.mode === "pinyin" ? "Pinyin" : SKILL_NAMES[session.mode]} by lesson</h2>
      {session.mode === "pinyin" && <p className="text-xs text-muted">Optional practice</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StatsLegend colors={ratingColors} />
        <span className="text-xs font-medium text-muted">Struggle</span>
      </div>
    </header>
    <ul className="divide-y divide-border" role="list">
      {Object.entries(session.lessons).map(([id, counts]) => {
        const name = lessonNames[id] ?? id;
        const rate = struggleRate(counts);
        const change = describeChange(rate, struggleRate(previous?.lessons[id]));
        return <li key={id} className="space-y-2 py-3">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="min-w-0 font-medium break-words">{name}</h3>
            <span className="shrink-0 text-xs text-muted">{plural(ratingCount(counts), "rating")}</span>
          </div>
          <div className="flex items-center gap-3">
            <StatsBar name={name} colors={ratingColors} counts={{ "Again/Hard": counts[0] + counts[1], "Good/Easy": counts[2] + counts[3] }} />
            {change && <span className="shrink-0 rounded-md bg-surface-muted px-1.5 py-0.5 text-xs text-muted tabular-nums">{change.chip}</span>}
            <StrugglePill rate={rate} context={`this session${change ? `, ${change.description} compared with last session` : ""}`} />
          </div>
        </li>;
      })}
    </ul>
    {!previous && <p className="pb-3 text-xs text-muted">First {SKILL_NAMES[session.mode].toLowerCase()} session</p>}
    {unrated.length > 0 && <details className="border-t border-border text-xs text-muted">
      <summary className="cursor-pointer py-3">{plural(unrated.length, "lesson")} with no ratings</summary>
      <p className="pb-3 break-words">{unrated.map(([, name]) => name).join(", ")}</p>
    </details>}
    {saveState === "saving" && <p role="status" className="pb-3 text-xs text-muted">Saving stats…</p>}
    {saveState === "failed" && <div role="status" className="pb-3">
      <p>Lesson stats couldn’t sync. Retry before leaving.</p>
      <button type="button" className="btn btn-secondary mt-1" onClick={onRetry}>Retry lesson stats</button>
    </div>}
  </section>;
}
