"use client";

import { useEffect, useState, type RefObject } from "react";

/**
 * iPad/iPhone Safari overlays the soft keyboard instead of resizing the page.
 * Returns the keyboard's height (for bottom padding) and keeps the focused
 * field centered in the visible area as the keyboard opens or resizes.
 */
export function useKeepInView(ref: RefObject<HTMLElement | null>): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const covered = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
        setInset(covered > 80 ? covered : 0);
        const field = ref.current;
        if (field && document.activeElement === field && covered > 80) {
          field.scrollIntoView({ block: "center", behavior: "smooth" });
        }
      });
    };
    // The field may mount after this effect (queue loading), so listen on the document.
    viewport.addEventListener("resize", update);
    document.addEventListener("focusin", update);
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener("resize", update);
      document.removeEventListener("focusin", update);
    };
  }, [ref]);
  return inset;
}
