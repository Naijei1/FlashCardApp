"use client";

import { useEffect, type RefObject } from "react";

/**
 * iPad/iPhone Safari overlays the soft keyboard instead of resizing the page.
 * Keep the focused field visible by scrolling its nearest study scroller — never
 * the document — so the page cannot rubber-band or get stuck.
 */
export function useKeepInView(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const viewport = window.visualViewport;

    const update = () => {
      const field = ref.current;
      if (!field || document.activeElement !== field) return;
      const scroller = field.closest(".study-scroll");
      if (!(scroller instanceof HTMLElement)) return;

      const live = window.visualViewport;
      const fieldRect = field.getBoundingClientRect();
      const scrollerRect = scroller.getBoundingClientRect();
      const visibleTop = live?.offsetTop ?? 0;
      const visibleBottom = visibleTop + (live?.height ?? window.innerHeight);
      const safeTop = Math.max(scrollerRect.top, visibleTop) + 8;
      const safeBottom = Math.min(scrollerRect.bottom, visibleBottom) - 8;
      if (fieldRect.top >= safeTop && fieldRect.bottom <= safeBottom) return;

      const target =
        fieldRect.top -
        scrollerRect.top +
        scroller.scrollTop -
        Math.max(24, (scroller.clientHeight - fieldRect.height) / 3);
      scroller.scrollTo({ top: Math.max(0, target), behavior: "auto" });
    };

    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    document.addEventListener("focusin", update);
    return () => {
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      document.removeEventListener("focusin", update);
    };
  }, [ref]);
}
