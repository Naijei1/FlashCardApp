"use client";
import InfoButton from "@/components/InfoButton";
import { useEffect, useState } from "react";
import { DAILY_WORD_GOAL, WEEKLY_WORD_GOAL } from "@/lib/practice";

type Progress = { today: number; week: number };

export default function WeeklyGoal({ initialProgress = null }: { initialProgress?: Progress | null }) {
  const [progress, setProgress] = useState<Progress | null>(initialProgress);
  useEffect(() => {
    if (initialProgress) setProgress(initialProgress);
    const controller = new AbortController();
    const update = async () => {
      try {
        const res = await fetch("/api/progress", { cache: "no-store", signal: controller.signal });
        if (res.ok) setProgress(await res.json());
      } catch { /* The goal remains visible when offline. */ }
    };
    // Installed iPad/iPhone apps resume with visibilitychange rather than focus.
    const onVisible = () => { if (document.visibilityState === "visible") void update(); };
    if (!initialProgress) void update();
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      controller.abort();
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [initialProgress]);
  const week = progress?.week ?? 0;
  const percent = Math.min(100, (week / WEEKLY_WORD_GOAL) * 100);
  return (
    <section className="card h-full p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-x-2">
        <div className="flex items-center gap-1">
          <h2 className="eyebrow">Weekly vocabulary goal</h2>
          <InfoButton topic="Weekly vocabulary goal">
            Aim for {DAILY_WORD_GOAL} new words a day, plus your due reviews. Counts words first studied
            Monday–Sunday (Eastern); learning a word takes later recall, not just introducing it.
          </InfoButton>
        </div>
        {progress && <span className="text-xs text-muted">Today {progress.today} / {DAILY_WORD_GOAL}</span>}
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">
        {progress ? `${week} / ${WEEKLY_WORD_GOAL}` : "Loading goal…"}
        {progress && <span className="ml-1.5 text-base font-normal text-muted">new words this week</span>}
      </p>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-border/70" role="progressbar"
        aria-label="Weekly new words" aria-valuemin={0} aria-valuemax={WEEKLY_WORD_GOAL} aria-valuenow={week}>
        <div className="h-full rounded-full bg-accent transition-[width] duration-500"
          style={{ width: `${percent}%` }} />
      </div>
    </section>
  );
}
