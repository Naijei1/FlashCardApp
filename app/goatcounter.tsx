"use client";

import { usePathname } from "next/navigation";
import Script from "next/script";
import { useEffect, useRef, useState } from "react";

type Pageview = { path: string; title: string; event: false };

const productionHosts = new Set(["flashcards.naijei.com"]);
const staticPaths = new Set([
  "/", "/admin", "/admin/upload", "/admin/users", "/browse", "/clinic",
  "/decks", "/groups/new", "/import", "/login", "/login/pwa-return",
  "/settings", "/stats", "/study",
]);

export function isAnalyticsHost(hostname: string): boolean {
  return productionHosts.has(hostname);
}

export function normalizeAnalyticsPath(pathname: string): string {
  const path = pathname.replace(/\/$/, "") || "/";
  if (staticPaths.has(path)) return path;

  const dynamicRoute = /^\/(cram|decks|groups|pinyin|review|study|write)\/[^/]+$/.exec(path);
  return dynamicRoute ? `/${dynamicRoute[1]}/:id` : "/other";
}

export default function GoatCounter() {
  const pathname = usePathname();
  const [enabled, setEnabled] = useState(false);
  const lastPath = useRef<string | null>(null);
  const pending = useRef<Pageview[]>([]);

  function flush() {
    const counter = (window as Window & {
      goatcounter?: { count?: (pageview: Pageview) => void };
    }).goatcounter;
    if (!counter?.count) return;

    for (const pageview of pending.current) counter.count(pageview);
    pending.current = [];
  }

  useEffect(() => {
    setEnabled(isAnalyticsHost(window.location.hostname));
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const path = normalizeAnalyticsPath(window.location.pathname);
    if (lastPath.current === path) return;

    lastPath.current = path;
    pending.current.push({ path, title: "Chinese Flashcards", event: false });
    flush();
  }, [enabled, pathname]);

  if (!enabled) return null;

  return (
    <Script
      src="https://gc.zgo.at/count.js"
      strategy="afterInteractive"
      data-goatcounter="https://naijei-flashcards.goatcounter.com/count"
      data-goatcounter-settings='{"no_onload":true,"allow_local":false}'
      onReady={flush}
    />
  );
}
