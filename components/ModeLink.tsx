import Link from "next/link";
import { IconChevronRight } from "./icons";

/** One study mode tile: title, short status line, and an optional due badge. */
export default function ModeLink({
  href,
  title,
  detail,
  badge,
  primary = false,
}: {
  href: string;
  title: string;
  detail: string;
  badge?: number;
  primary?: boolean;
}) {
  return (
    <Link
      href={href}
      prefetch={false}
      className={`pressable group flex items-center gap-3 rounded-2xl px-5 py-4 ${
        primary
          ? "bg-accent text-accent-foreground shadow-sm hover:brightness-110"
          : "card hover:border-accent/50"
      }`}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-semibold">{title}</span>
        <span className={`block text-sm ${primary ? "opacity-85" : "text-muted"}`}>{detail}</span>
      </span>
      {badge !== undefined && badge > 0 && (
        <span className={`rounded-full px-2.5 py-0.5 text-sm font-semibold tabular-nums ${
          primary ? "bg-white/20" : "bg-accent/10 text-accent"
        }`}>
          {badge}
        </span>
      )}
      <IconChevronRight className={`shrink-0 text-xl transition-transform group-hover:translate-x-0.5 ${primary ? "opacity-80" : "text-muted"}`} />
    </Link>
  );
}
