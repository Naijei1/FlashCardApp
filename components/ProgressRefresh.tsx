"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { currentLocalUserId, subscribeLocalUser } from "@/lib/browser-user-scope";
import { isStudyRoute, REFRESH_COALESCE_MS, RESUME_REFRESH_GAP_MS } from "@/lib/progress-refresh";
import { createReviewSync, subscribeReviewPersisted } from "./reviewSync";

/**
 * Refreshes server-rendered progress after a confirmed save, after leaving a
 * study session, and when the window is visible again (including an installed
 * iPhone home-screen app, which resumes with visibility/pageshow rather than
 * a fresh document). An open session is left alone so the current card stays put.
 */
export default function ProgressRefresh() {
  const router = useRouter();
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  const routerRef = useRef(router);
  routerRef.current = router;
  const userRef = useRef<string | null>(null);
  const awayRef = useRef(false);
  const lastRefreshRef = useRef(Number.NEGATIVE_INFINITY);
  const timerRef = useRef<number | null>(null);
  const reasonRef = useRef<"resume" | "data">("resume");
  const requestRef = useRef<(reason: "resume" | "data") => void>(() => {});

  requestRef.current = (reason: "resume" | "data") => {
    if (isStudyRoute(pathnameRef.current)) return;
    if (reason === "data") reasonRef.current = "data";
    else if (timerRef.current === null) reasonRef.current = "resume";
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      const why = reasonRef.current;
      reasonRef.current = "resume";
      if (isStudyRoute(pathnameRef.current)) return;
      if (why === "resume") {
        if (document.visibilityState === "hidden") return;
        if (Date.now() - lastRefreshRef.current < RESUME_REFRESH_GAP_MS) return;
      }
      lastRefreshRef.current = Date.now();
      routerRef.current.refresh();
    }, REFRESH_COALESCE_MS);
  };

  useEffect(() => {
    userRef.current = currentLocalUserId();
    // Keep the offline queue alive on summary screens so a flush can finish
    // after the session unmounts, and so a reload on Home still drains it.
    const sync = createReviewSync(() => {});
    const stopPersist = subscribeReviewPersisted((event) => {
      if (event.userId !== userRef.current) return;
      requestRef.current("data");
    });
    const stopUser = subscribeLocalUser((next) => {
      userRef.current = next;
    });
    const markAway = () => {
      awayRef.current = true;
    };
    const onResume = () => {
      if (document.visibilityState === "hidden") return;
      if (!awayRef.current) return;
      awayRef.current = false;
      requestRef.current("resume");
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") markAway();
      else onResume();
    };
    const onPageShow = () => {
      if (awayRef.current) onResume();
    };
    window.addEventListener("blur", markAway);
    window.addEventListener("focus", onResume);
    window.addEventListener("pagehide", markAway);
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopPersist();
      stopUser();
      sync.dispose();
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      window.removeEventListener("blur", markAway);
      window.removeEventListener("focus", onResume);
      window.removeEventListener("pagehide", markAway);
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const previousPath = useRef(pathname);
  useEffect(() => {
    const previous = previousPath.current;
    previousPath.current = pathname;
    if (previous !== pathname && isStudyRoute(previous) && !isStudyRoute(pathname)) {
      requestRef.current("data");
    }
  }, [pathname]);

  return null;
}
