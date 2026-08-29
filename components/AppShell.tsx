"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Home", icon: "🏠" },
  { href: "/browse", label: "Browse", icon: "🔍" },
  { href: "/import", label: "Import", icon: "📥" },
  { href: "/stats", label: "Stats", icon: "📊" },
  { href: "/settings", label: "Settings", icon: "⚙️" },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // Study screens use their own full-screen layout with no nav chrome.
  const immersive = pathname.startsWith("/study/") || pathname.startsWith("/review/");

  if (immersive) {
    return <div className="min-h-dvh pt-safe">{children}</div>;
  }

  return (
    <div className="min-h-dvh md:flex">
      {/* Desktop sidebar */}
      <aside className="hidden w-56 shrink-0 border-r border-border md:block">
        <div className="sticky top-0 flex h-dvh flex-col p-4">
          <Link href="/" className="mb-6 flex items-center gap-2 px-2 text-lg font-semibold">
            <span className="text-2xl">学</span> Flashcards
          </Link>
          <nav className="space-y-1">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${
                  isActive(pathname, item.href)
                    ? "bg-accent/15 font-medium text-accent"
                    : "text-muted hover:bg-border/40 hover:text-foreground"
                }`}
              >
                <span aria-hidden>{item.icon}</span>
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </aside>

      {/* Content */}
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-safe pb-24 md:px-8 md:pb-8">
        {children}
      </main>

      {/* Mobile bottom tabs */}
      <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-surface/95 backdrop-blur pb-safe md:hidden">
        <div className="flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] ${
                isActive(pathname, item.href) ? "text-accent" : "text-muted"
              }`}
            >
              <span className="text-xl leading-none" aria-hidden>
                {item.icon}
              </span>
              {item.label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
