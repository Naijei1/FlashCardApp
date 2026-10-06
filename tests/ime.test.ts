import type { KeyboardEvent } from "react";
import { describe, expect, it } from "vitest";
import { isImeEnter } from "@/lib/ime";

const key = (key: string, isComposing: boolean, keyCode = 13) =>
  ({ key, keyCode, nativeEvent: { isComposing } }) as unknown as KeyboardEvent;

describe("isImeEnter", () => {
  it("flags Enter that confirms a candidate, including Safari's late keyCode 229", () => {
    expect(isImeEnter(key("Enter", true))).toBe(true);
    expect(isImeEnter(key("Enter", false, 229))).toBe(true);
  });
  it("lets a plain Enter and other keys through", () => {
    expect(isImeEnter(key("Enter", false))).toBe(false);
    expect(isImeEnter(key("a", true))).toBe(false);
  });
});
