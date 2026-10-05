"use client";

import { useEffect, useState } from "react";
import { previewIntervals } from "@/lib/fsrs";
import type { StoredFsrs } from "@/lib/types";

const RATINGS = [
  { value: 1, key: "again", label: "Retry", classes: "text-red-700 dark:text-red-300 bg-red-500/10 hover:bg-red-500/15 active:bg-red-500/25" },
  { value: 2, key: "hard", label: "Hard", classes: "text-amber-700 dark:text-amber-300 bg-amber-500/10 hover:bg-amber-500/15 active:bg-amber-500/25" },
  { value: 3, key: "good", label: "Good", classes: "text-green-700 dark:text-green-300 bg-green-500/10 hover:bg-green-500/15 active:bg-green-500/25" },
  { value: 4, key: "easy", label: "Easy", classes: "text-sky-700 dark:text-sky-300 bg-sky-500/10 hover:bg-sky-500/15 active:bg-sky-500/25" },
] as const;

export default function RatingBar({
  fsrs,
  onRate,
  defaultValue,
}: {
  fsrs: StoredFsrs;
  onRate: (rating: number) => void;
  /** Rating applied by Enter; gets a subtle ring so the shortcut is visible. */
  defaultValue?: number;
}) {
  const [, refresh] = useState(0);
  useEffect(() => {
    const update = () => refresh((value) => value + 1);
    const timer = window.setInterval(update, 1000);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  // A queue can remain open for days. Preview from the time of this rating,
  // not the time the batch was fetched or the previous learning step was due.
  const intervals = previewIntervals(fsrs, new Date());
  return (
    <div className="w-full">
      <p className="mb-2 text-center text-xs text-muted">Next review after this rating</p>
      <div className="grid w-full grid-cols-4 gap-2">
        {RATINGS.map((r) => (
          <button
            key={r.value}
            type="button"
            onClick={() => onRate(r.value)}
            className={`pressable flex min-h-16 flex-col items-center justify-center gap-0.5 rounded-2xl font-semibold ${r.classes} ${
              defaultValue === r.value ? "ring-2 ring-current/40" : ""
            }`}
          >
            {r.label}
            <span className="text-xs font-normal tabular-nums opacity-70">{intervals[r.key]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
