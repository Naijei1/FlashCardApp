"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import {
  IconHome,
  IconImport,
  IconSearch,
  IconSettings,
  IconStats,
} from "./icons";

const NAV = [
  { href: "/", label: "Home", Icon: IconHome },
  { href: "/browse", label: "Browse", Icon: IconSearch },
  { href: "/import", label: "Import", Icon: IconImport },
  { href: "/stats", label: "Stats", Icon: IconStats },
  { href: "/settings", label: "Settings", Icon: IconSettings },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" || pathname.startsWith("/decks/") : pathname.startsWith(href);
}

function noop() {}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // iOS Safari only applies :active (our press feedback) once a touch listener exists.
  useEffect(() => {
    document.addEventListener("touchstart", noop, { passive: true });
    return () => document.removeEventListener("touchstart", noop);
  }, []);
  // Study screens use their own full-screen layout with no nav chrome.
  const immersive =
    pathname.startsWith("/study/") ||
    pathname.startsWith("/review/") ||
    pathname.startsWith("/write/") ||
    pathname.startsWith("/pinyin/");

  if (immersive) {
    // Put the top safe-area padding inside the full-height study screen. A
    // padded wrapper around a 100dvh child makes the page taller than the
    // viewport and causes a persistent iPhone scroll bounce.
    return (
      <div className="min-h-dvh [&>*]:pt-[env(safe-area-inset-top)]">{children}</div>
    );
  }

  return (
    <div className="min-h-dvh md:flex">
      <a
        href="#main-content"
        className="sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:not-sr-only focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2 focus:shadow"
      >
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 border-r border-border bg-surface/60 md:block">
        <div className="sticky top-0 flex h-dvh flex-col p-4">
          <Link href="/" className="mb-8 flex min-h-11 items-center gap-2.5 px-2 text-lg font-semibold tracking-tight">
            <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-xl text-accent-foreground">
              学
            </span>
            Flashcards
          </Link>
          <nav aria-label="Primary navigation" className="space-y-1">
            {NAV.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium ${
                    active
                      ? "bg-accent/10 text-accent"
                      : "text-muted hover:bg-surface-muted hover:text-foreground"
                  }`}
                >
                  <item.Icon className="text-base" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </aside>

      {/* Content */}
      <main
        id="main-content"
        className="mx-auto w-full max-w-3xl flex-1 px-safe pt-safe pb-28 [--gutter:1rem] sm:[--gutter:1.5rem] md:pb-12 md:[--gutter:2.5rem] lg:max-w-4xl xl:max-w-5xl"
      >
        {children}
      </main>

      {/* Mobile bottom tabs */}
      <nav
        aria-label="Primary navigation"
        className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-surface/90 pb-safe backdrop-blur-md md:hidden"
      >
        <div className="flex px-safe [--gutter:0px]">
          {NAV.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium ${
                  active ? "text-accent" : "text-muted"
                }`}
              >
                <item.Icon className="text-[22px]" strokeWidth={1.8} />
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
