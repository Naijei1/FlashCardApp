import { describe, expect, it } from "vitest";
import {
  checkAnswer,
  chineseSideForCard,
  chineseSideForDeck,
  diffChars,
  isChineseLang,
  normalizeAnswer,
  toWritePrompt,
} from "@/lib/write";
import type { Card } from "@/lib/types";
import { emptyCardState } from "@/lib/fsrs";

const NOW = new Date("2026-08-29T12:00:00Z");

function makeCard(front: string, back: string, notes?: string): Card {
  return {
    id: "c1",
    deckId: "d1",
    front,
    back,
    ...(notes ? { notes } : {}),
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    fsrs: emptyCardState(NOW),
  };
}

describe("isChineseLang", () => {
  it("matches zh variants", () => {
    expect(isChineseLang("zh-CN")).toBe(true);
    expect(isChineseLang("zh-TW")).toBe(true);
    expect(isChineseLang("zh_CN")).toBe(true);
    expect(isChineseLang("ZH-cn")).toBe(true);
  });
  it("rejects others", () => {
    expect(isChineseLang("en-US")).toBe(false);
    expect(isChineseLang(undefined)).toBe(false);
    expect(isChineseLang("")).toBe(false);
  });
});

describe("chineseSideForDeck", () => {
  it("uses configured languages first", () => {
    expect(chineseSideForDeck({ frontLanguage: "zh-CN", backLanguage: "en-US" })).toBe("front");
    expect(chineseSideForDeck({ frontLanguage: "en-US", backLanguage: "zh-CN" })).toBe("back");
  });
  it("falls back to explicit chineseSide", () => {
    expect(chineseSideForDeck({ chineseSide: "back" })).toBe("back");
  });
  it("languages win over chineseSide", () => {
    expect(chineseSideForDeck({ frontLanguage: "zh-CN", chineseSide: "back" })).toBe("front");
  });
  it("returns null when unknown", () => {
    expect(chineseSideForDeck({})).toBeNull();
    expect(chineseSideForDeck({ frontLanguage: "en-US", backLanguage: "ja-JP" })).toBeNull();
  });
});

describe("chineseSideForCard", () => {
  it("detects hanzi per card regardless of deck setting", () => {
    expect(chineseSideForCard({ front: "老师", back: "teacher" }, "back")).toBe("front");
    expect(chineseSideForCard({ front: "teacher", back: "老师" }, "front")).toBe("back");
  });
  it("falls back to the deck side when ambiguous", () => {
    expect(chineseSideForCard({ front: "lǎoshī", back: "teacher" }, "front")).toBe("front");
    expect(chineseSideForCard({ front: "你好", back: "您好" }, "back")).toBe("back");
  });
  it("returns null when ambiguous and no deck side", () => {
    expect(chineseSideForCard({ front: "a", back: "b" }, null)).toBeNull();
  });
});

describe("toWritePrompt", () => {
  it("prompts with English, expects Chinese (Chinese on front)", () => {
    const p = toWritePrompt(makeCard("老师", "teacher", "n"), "front");
    expect(p).toEqual({ prompt: "teacher", answer: "老师", notes: "n" });
  });
  it("prompts with English, expects Chinese (Chinese on back)", () => {
    const p = toWritePrompt(makeCard("teacher", "老师"), "back");
    expect(p.prompt).toBe("teacher");
    expect(p.answer).toBe("老师");
  });
});

describe("normalizeAnswer / checkAnswer", () => {
  it("trims and collapses whitespace", () => {
    expect(normalizeAnswer("  老师　 ")).toBe("老师");
    expect(normalizeAnswer("nǐ   hǎo")).toBe("nǐ hǎo");
  });
  it("accepts exact match", () => {
    expect(checkAnswer("老师", "老师")).toBe(true);
  });
  it("accepts surrounding whitespace", () => {
    expect(checkAnswer(" 老师 ", "老师")).toBe(true);
  });
  it("accepts internal-spacing differences", () => {
    expect(checkAnswer("老 师", "老师")).toBe(true);
  });
  it("rejects wrong characters", () => {
    expect(checkAnswer("老是", "老师")).toBe(false);
  });
  it("rejects empty input", () => {
    expect(checkAnswer("", "老师")).toBe(false);
    expect(checkAnswer("   ", "老师")).toBe(false);
  });
  it("works for pinyin cards", () => {
    expect(checkAnswer("lǎoshī", "lǎoshī")).toBe(true);
  });
});

describe("diffChars", () => {
  it("marks a one-character mistake (老是 vs 老师)", () => {
    const d = diffChars("老是", "老师");
    expect(d.typed).toEqual([
      { char: "老", ok: true },
      { char: "是", ok: false },
    ]);
    expect(d.expected).toEqual([
      { char: "老", ok: true },
      { char: "师", ok: false },
    ]);
  });

  it("marks everything ok on an exact match", () => {
    const d = diffChars("你好", "你好");
    expect(d.typed.every((c) => c.ok)).toBe(true);
    expect(d.expected.every((c) => c.ok)).toBe(true);
  });

  it("flags missing trailing characters", () => {
    const d = diffChars("你", "你好");
    expect(d.typed).toEqual([{ char: "你", ok: true }]);
    expect(d.expected).toEqual([
      { char: "你", ok: true },
      { char: "好", ok: false },
    ]);
  });

  it("flags extra typed characters", () => {
    const d = diffChars("你好吗", "你好");
    expect(d.typed[2]).toEqual({ char: "吗", ok: false });
    expect(d.expected.every((c) => c.ok)).toBe(true);
  });

  it("handles a completely wrong answer", () => {
    const d = diffChars("猫", "狗");
    expect(d.typed).toEqual([{ char: "猫", ok: false }]);
    expect(d.expected).toEqual([{ char: "狗", ok: false }]);
  });
});
