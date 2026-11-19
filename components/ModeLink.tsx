import type { ReactNode } from "react";
import Link from "next/link";
import { IconChevronRight } from "./icons";

/** One study mode tile: title, short status line, and an optional due badge. */
export default function ModeLink({
  href,
  title,
  detail,
  chips,
  badge,
  kicker,
  primary = false,
  unframed = false,
  prefetch = false,
}: {
  href: string;
  title: string;
  detail?: string;
  chips?: ReactNode;
  badge?: number;
  kicker?: string;
  primary?: boolean;
  unframed?: boolean;
  /** Prefetch the route shell. Leave off for pages that load every card. */
  prefetch?: boolean;
}) {
  return (
    <Link
      href={href}
      prefetch={prefetch}
      aria-label={!chips && detail ? `${title}. ${detail}` : undefined}
      className={`pressable group flex min-h-20 items-center gap-3 rounded-2xl px-5 py-4 ${
        primary
          ? "bg-accent text-accent-foreground shadow-sm hover:brightness-110"
          : unframed ? "hover:bg-surface-muted/50" : "card hover:border-accent/50"
      }`}
    >
      <span className="min-w-0 flex-1">
        {kicker && (
          <span className={`mb-1 block text-[11px] font-semibold tracking-wider uppercase ${
            primary ? "text-accent-foreground/80" : "text-accent"
          }`}>
            {kicker}
          </span>
        )}
        <span className="block truncate text-base font-semibold">{title}</span>
        {chips ? <span className="mt-1 flex flex-wrap gap-1.5">{chips}</span> : <span className={`block text-sm ${primary ? "opacity-85" : "text-muted"}`}>{detail}</span>}
      </span>
      {badge !== undefined && badge > 0 && (
        <span aria-hidden={!!chips} className={`shrink-0 rounded-full px-2.5 py-0.5 text-sm font-semibold tabular-nums ${
          primary ? "bg-white/20" : "bg-accent/10 text-accent"
        }`}>
          {badge}
        </span>
      )}
      <IconChevronRight className={`shrink-0 text-xl transition-transform group-hover:translate-x-0.5 ${primary ? "opacity-80" : "text-muted"}`} />
    </Link>
  );
}
