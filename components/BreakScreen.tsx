"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { clearBreak, formatCountdown } from "@/lib/study-break";
import { IconClock } from "./icons";

/** Enforced 5-minute pause between review batches. */
export default function BreakScreen({
  until,
  reviewed,
  waiting,
  backHref,
  onContinue,
}: {
  until: number;
  /** Cards rated in the batch just finished (0 when resuming a stored break). */
  reviewed: number;
  /** Cards still waiting after the break, if known. */
  waiting: number | null;
  backHref: string;
  onContinue: () => void;
}) {
  const [msLeft, setMsLeft] = useState(() => until - Date.now());

  useEffect(() => {
    const tick = () => setMsLeft(until - Date.now());
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [until]);

  const done = msLeft <= 0;

  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-4 px-6 pb-safe text-center">
      <IconClock className="text-4xl text-muted" strokeWidth={1.5} />
      <h1 className="text-xl font-semibold">
        {reviewed > 0 ? "Batch complete — take a break" : "Break time"}
      </h1>
      <p className="text-muted">
        {reviewed > 0 && `You reviewed ${reviewed} card${reviewed === 1 ? "" : "s"}. `}
        {waiting !== null && waiting > 0
          ? `${waiting} more card${waiting === 1 ? "" : "s"} waiting after a short rest.`
          : "A short rest helps the next batch stick."}
      </p>
      <div className="text-5xl font-bold tabular-nums" aria-live="polite">
        {formatCountdown(msLeft)}
      </div>
      <button
        type="button"
        disabled={!done}
        onClick={() => {
          clearBreak();
          onContinue();
        }}
        className="pressable min-h-14 w-full max-w-xs rounded-2xl bg-accent text-lg font-semibold text-accent-foreground disabled:opacity-40"
      >
        {done ? "Continue" : "Resting…"}
      </button>
      <Link href={backHref} className="pressable rounded-lg px-3 py-2 text-sm text-muted">
        ← Back to deck
      </Link>
    </div>
  );
}
