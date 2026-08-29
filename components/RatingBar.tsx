"use client";

import type { IntervalPreview } from "@/lib/fsrs";

export const RATINGS = [
  {
    value: 1,
    key: "again" as const,
    label: "Retry",
    classes: "text-red-600 dark:text-red-400 bg-red-500/10 active:bg-red-500/25",
  },
  {
    value: 2,
    key: "hard" as const,
    label: "Hard",
    classes: "text-amber-600 dark:text-amber-400 bg-amber-500/10 active:bg-amber-500/25",
  },
  {
    value: 3,
    key: "good" as const,
    label: "Good",
    classes: "text-green-700 dark:text-green-400 bg-green-500/10 active:bg-green-500/25",
  },
  {
    value: 4,
    key: "easy" as const,
    label: "Easy",
    classes: "text-sky-600 dark:text-sky-400 bg-sky-500/10 active:bg-sky-500/25",
  },
];

export default function RatingBar({
  intervals,
  onRate,
  defaultValue,
}: {
  intervals: IntervalPreview;
  onRate: (rating: number) => void;
  /** Rating applied by Enter; gets a subtle ring so the shortcut is visible. */
  defaultValue?: number;
}) {
  return (
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
          <span className="text-[11px] font-normal opacity-60">
            {intervals[r.key]}
          </span>
        </button>
      ))}
    </div>
  );
}
