"use client";

import { useCallback, useRef, useState } from "react";

/** Pencil strokes landing on a button this soon after text arrives are part of handwriting. */
const PEN_SETTLE_MS = 500;

/**
 * Keeps Scribble (Apple Pencil handwriting) and IME composition from submitting
 * an answer mid-word: actions are blocked while text is being composed, and a
 * pen tap right after Scribble inserted text is ignored.
 */
export function useHandwritingGuard() {
  const [composing, setComposing] = useState(false);
  const lastInputAt = useRef(Number.NEGATIVE_INFINITY);
  const lastPointerType = useRef("");

  const inputProps = {
    onCompositionStart: () => setComposing(true),
    onCompositionEnd: () => {
      setComposing(false);
      lastInputAt.current = performance.now();
    },
    onInput: () => {
      lastInputAt.current = performance.now();
    },
  };

  const guard = useCallback(
    (action: () => void) => ({
      onPointerDown: (event: React.PointerEvent) => {
        lastPointerType.current = event.pointerType;
      },
      onClick: () => {
        const pen = lastPointerType.current === "pen";
        lastPointerType.current = "";
        if (composing) return;
        if (pen && performance.now() - lastInputAt.current < PEN_SETTLE_MS) return;
        action();
      },
    }),
    [composing]
  );

  return { composing, inputProps, guard };
}
