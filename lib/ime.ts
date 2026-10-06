import type { KeyboardEvent } from "react";

/**
 * Enter that confirms an IME candidate (pinyin keyboards, Scribble conversions)
 * must not submit the surrounding form. Safari may report keyCode 229 after
 * isComposing has already become false.
 */
export function isImeEnter(event: KeyboardEvent): boolean {
  return event.key === "Enter" && (event.nativeEvent.isComposing || event.keyCode === 229);
}

export function preventImeSubmit(event: KeyboardEvent): void {
  if (isImeEnter(event)) event.preventDefault();
}
