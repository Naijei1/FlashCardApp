"use client";

import { useRef } from "react";

const MIN_DISTANCE = 60;

/**
 * Horizontal swipe via pointer events (finger, Apple Pencil, or mouse drag).
 * `consumeClick` reports whether the click that ends a swipe should be ignored.
 */
export function useSwipe(onSwipe: (direction: "left" | "right") => void) {
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const swiped = useRef(false);
  return {
    handlers: {
      onPointerDown(event: React.PointerEvent) {
        if (event.isPrimary === false) return;
        start.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
        swiped.current = false;
      },
      onPointerUp(event: React.PointerEvent) {
        const origin = start.current;
        start.current = null;
        if (!origin || origin.id !== event.pointerId) return;
        const dx = event.clientX - origin.x;
        const dy = event.clientY - origin.y;
        if (Math.abs(dx) >= MIN_DISTANCE && Math.abs(dx) > Math.abs(dy) * 1.5) {
          swiped.current = true;
          onSwipe(dx < 0 ? "left" : "right");
        }
      },
      onPointerCancel() {
        start.current = null;
      },
    },
    consumeClick() {
      const was = swiped.current;
      swiped.current = false;
      return was;
    },
  };
}
