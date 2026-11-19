import { struggleLevel } from "@/lib/lesson-stats";

export const readinessColors = {
  Solid: "bg-emerald-600 dark:bg-emerald-400",
  Shaky: "bg-amber-400 dark:bg-amber-400",
  Unseen: "bg-zinc-300 dark:bg-zinc-600",
};
export const ratingColors = {
  "Again/Hard": readinessColors.Shaky,
  "Good/Easy": readinessColors.Solid,
};

export function StatsLegend({ colors }: { colors: Record<string, string> }) {
  return <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
    {Object.entries(colors).map(([name, color]) => <span key={name} className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className={`size-2 rounded-full ${color}`} />{name}
    </span>)}
  </div>;
}

export function StatsBar<K extends string>({ name, colors, counts }: {
  name: string; colors: Record<K, string>; counts: Record<K, number>;
}) {
  const keys = Object.keys(colors) as K[];
  const segments = keys.map((key) => ({ count: counts[key], color: colors[key], label: `${counts[key]} ${key.toLowerCase()}` }));
  const label = `${name}: ${segments.map((s) => s.label).join(", ")}`;
  return <div role="img" aria-label={label} title={label} className="flex h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-muted">
    {segments.map(({ count, color, label }) => <span key={label} title={label} className={color} style={{ flexGrow: count }} />)}
  </div>;
}

const pillColors = {
  low: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  medium: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
  high: "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-300",
  unrated: "bg-surface-muted text-muted",
};

export function StrugglePill({ rate, context, arrow }: { rate: number | null; context: string; arrow?: string }) {
  const percent = rate === null ? "—" : `${Math.round(rate * 100)}%`;
  const label = rate === null ? "No recent ratings" : `Struggle ${percent} ${context}`;
  return <span role="img" aria-label={label} title={label}
    className={`inline-flex min-w-14 justify-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${pillColors[struggleLevel(rate)]}`}>
    {percent}{arrow && <span>{arrow}</span>}
  </span>;
}
