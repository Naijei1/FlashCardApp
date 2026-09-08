import { afterEach, describe, expect, it, vi } from "vitest";
import { shouldIgnoreGlobalKeydown } from "@/components/useKeyboard";

class FakeElement {
  constructor(private readonly interactive: boolean) {}

  closest() {
    return this.interactive ? this : null;
  }
}

function keyboardEvent(
  overrides: Partial<KeyboardEvent> & { target?: EventTarget | null } = {}
): KeyboardEvent {
  return {
    defaultPrevented: false,
    repeat: false,
    isComposing: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    target: null,
    ...overrides,
  } as KeyboardEvent;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("global keyboard shortcut filtering", () => {
  it("leaves keys on interactive controls to their native handlers", () => {
    vi.stubGlobal("Element", FakeElement);
    expect(
      shouldIgnoreGlobalKeydown(
        keyboardEvent({ target: new FakeElement(true) as unknown as EventTarget })
      )
    ).toBe(true);
  });

  it("allows shortcuts from non-interactive content", () => {
    vi.stubGlobal("Element", FakeElement);
    expect(
      shouldIgnoreGlobalKeydown(
        keyboardEvent({ target: new FakeElement(false) as unknown as EventTarget })
      )
    ).toBe(false);
  });

  it.each([
    { defaultPrevented: true },
    { repeat: true },
    { isComposing: true },
    { metaKey: true },
    { ctrlKey: true },
    { altKey: true },
  ])("ignores handled, repeated, composing, and modified events: %o", (flags) => {
    vi.stubGlobal("Element", FakeElement);
    expect(shouldIgnoreGlobalKeydown(keyboardEvent(flags))).toBe(true);
  });
});
