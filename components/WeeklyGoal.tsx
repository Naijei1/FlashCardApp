"use client";
import { useEffect, useState } from "react";
import { DAILY_WORD_GOAL, WEEKLY_WORD_GOAL } from "@/lib/practice";

export default function WeeklyGoal() {
  const [progress, setProgress] = useState<{ today: number; week: number } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const update = async () => {
      try {
        const res = await fetch("/api/progress", { cache: "no-store", signal: controller.signal });
        if (res.ok) setProgress(await res.json());
      } catch { /* The goal remains visible when offline. */ }
    };
    void update();
    window.addEventListener("focus", update);
    return () => { controller.abort(); window.removeEventListener("focus", update); };
  }, []);
  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <h2 className="text-sm font-medium uppercase tracking-wide text-muted">Weekly vocabulary goal</h2>
      <p className="mt-2 text-2xl font-semibold">{progress ? `${progress.week} / ${WEEKLY_WORD_GOAL}` : WEEKLY_WORD_GOAL} new words this week</p>
      <p className="mt-2 text-sm text-muted">
        Aim for {DAILY_WORD_GOAL} new words a day, plus your due reviews.
        {progress ? ` Today: ${progress.today} / ${DAILY_WORD_GOAL}.` : ""}
      </p>
      <p className="mt-2 text-xs text-muted">Counts words first studied since this tracker was added, Monday–Sunday (Eastern). Learning a word takes later recall, not just introducing it.</p>
    </section>
  );
}
