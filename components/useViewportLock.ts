"use client";

import { useLayoutEffect, useState } from "react";

const KEYBOARD_COVER_PX = 80;

function visualCover(): number {
  const viewport = window.visualViewport;
  if (!viewport) return 0;
  return Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
}

export function isSoftKeyboardOpen(): boolean {
  return visualCover() > KEYBOARD_COVER_PX;
}

export function scrollDocumentToTop() {
  window.scrollTo(0, 0);
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
}

/**
 * Pins immersive study screens to the visual viewport (iOS URL bar + keyboard)
 * and reports when the soft keyboard is covering the page.
 */
export function useViewportLock(immersive: boolean): boolean {
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("immersive", immersive);

    const viewport = window.visualViewport;

    const update = () => {
      const live = window.visualViewport;
      const height = live?.height ?? window.innerHeight;
      const offset = live?.offsetTop ?? 0;
      const open = visualCover() > KEYBOARD_COVER_PX;
      setKeyboardOpen(open);
      root.classList.toggle("keyboard-open", open);
      if (immersive) {
        root.style.setProperty("--app-height", `${height}px`);
        root.style.setProperty("--app-offset", `${offset}px`);
      }
    };

    if (immersive) {
      scrollDocumentToTop();
      update();
    } else {
      root.style.removeProperty("--app-height");
      root.style.removeProperty("--app-offset");
      setKeyboardOpen(isSoftKeyboardOpen());
      root.classList.toggle("keyboard-open", isSoftKeyboardOpen());
    }

    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      root.classList.remove("immersive", "keyboard-open");
      root.style.removeProperty("--app-height");
      root.style.removeProperty("--app-offset");
    };
  }, [immersive]);

  return keyboardOpen;
}
