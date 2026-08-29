import { describe, expect, it } from "vitest";
import { buildCards } from "@/lib/cards";
import { State } from "@/lib/fsrs";

const NOW = new Date("2026-08-28T12:00:00Z");

describe("buildCards", () => {
  it("creates a single card without reverse", () => {
    const cards = buildCards(
      { deckId: "d1", front: "你好", back: "hello" },
      NOW
    );
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      deckId: "d1",
      front: "你好",
      back: "hello",
      createdAt: NOW.toISOString(),
    });
  });

  it("creates two independent cards with reverse", () => {
    let n = 0;
    const cards = buildCards(
      { deckId: "d1", front: "你好", back: "hello", notes: "greeting", reverse: true },
      NOW,
      () => `id-${n++}`
    );
    expect(cards).toHaveLength(2);
    const [forward, reverse] = cards;
    expect(forward.front).toBe("你好");
    expect(forward.back).toBe("hello");
    expect(reverse.front).toBe("hello");
    expect(reverse.back).toBe("你好");
    expect(reverse.notes).toBe("greeting");
    expect(forward.id).not.toBe(reverse.id);
    // Independent FSRS states (equal-valued but distinct objects).
    expect(forward.fsrs).not.toBe(reverse.fsrs);
    expect(forward.fsrs.state).toBe(State.New);
    expect(reverse.fsrs.state).toBe(State.New);
  });

  it("omits notes when not provided", () => {
    const cards = buildCards({ deckId: "d1", front: "a", back: "b" }, NOW);
    expect("notes" in cards[0]).toBe(false);
  });
});
