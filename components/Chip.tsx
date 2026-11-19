import type { ReactNode } from "react";

const tones = {
  neutral: "bg-surface-muted text-foreground",
  accent: "bg-[color-mix(in_srgb,var(--accent)_8%,var(--surface))] text-accent",
  success: "bg-emerald-500/10 text-emerald-800 dark:text-emerald-200",
  warning: "bg-amber-500/10 text-amber-800 dark:text-amber-200",
};

export default function Chip({ children, tone = "neutral" }: {
  children: ReactNode;
  tone?: keyof typeof tones;
}) {
  return <span className={`inline-block rounded-full px-2.5 py-1 text-xs tabular-nums ${tones[tone]}`}>{children}</span>;
}
