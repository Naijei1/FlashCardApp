import { describe, expect, it } from "vitest";
import { checkPinyinAnswer, numberedPinyin, pinyinTextForCard } from "@/lib/pinyin";
import { buildPinyinQueueData, readingForCard } from "@/lib/pinyin-queue";
import { emptyCardState } from "@/lib/fsrs";
import type { Card } from "@/lib/types";

const NOW = new Date("2026-09-08T12:00:00.000Z");
function card(front: string, back: string, id = front): Card {
  return {
    id, deckId: "deck", front, back,
    createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
    fsrs: emptyCardState(NOW),
  };
}

describe("automatic Pinyin readings", () => {
  it.each(["行 (háng)", "行（hang2）", "行 háng"])("honors the author's alternate pronunciation in %s", (text) => {
    expect(readingForCard(card(text, "line"), null)?.syllables).toEqual(["háng"]);
    expect(readingForCard(card("line", text), null)?.syllables).toEqual(["háng"]);
  });
  it("validates a whole reading instead of treating English or partial annotations as Pinyin", () => {
    expect(readingForCard(card("行 (line)", "line"), null)?.syllables).toEqual(["xíng"]);
    expect(readingForCard(card("银行 (háng)", "bank"), null)?.syllables).toEqual(["yín", "háng"]);
    expect(readingForCard(card("你好 (ni3hao3)", "hello"), null)?.syllables).toEqual(["nǐ", "hǎo"]);
    expect(readingForCard(card("行 (ni3)", "line"), null)?.syllables).toEqual(["xíng"]);
  });
  it("detects Chinese on either side, even when a deck contains reversed cards", () => {
    expect(readingForCard(card("你好", "hello"), "back")).toMatchObject({
      hanzi: "你好", meaning: "hello", syllables: ["nǐ", "hǎo"],
    });
    expect(readingForCard(card("hello", "你好"), "front")).toMatchObject({
      hanzi: "你好", meaning: "hello", syllables: ["nǐ", "hǎo"],
    });
  });

  it("uses phrase context and supports traditional characters", () => {
    expect(readingForCard(card("银行", "bank"), null)?.syllables).toEqual(["yín", "háng"]);
    expect(readingForCard(card("重庆", "Chongqing"), null)?.syllables).toEqual(["chóng", "qìng"]);
    expect(readingForCard(card("中國", "China"), null)?.syllables).toEqual(["zhōng", "guó"]);
  });

  it("uses dictionary tones and recognizes neutral tones", () => {
    expect(readingForCard(card("一杯", "a cup"), null)?.syllables).toEqual(["yī", "bēi"]);
    expect(readingForCard(card("妈妈", "mom"), null)?.syllables).toEqual(["mā", "ma"]);
  });

  it("removes existing romanization and punctuation from the question", () => {
    expect(pinyinTextForCard(card("你好 (nǐ hǎo), 世界!", "hello world"), null)).toEqual({
      hanzi: "你好 世界", meaning: "hello world",
    });
  });

  it("excludes English-only cards and unsupported readings", () => {
    expect(readingForCard(card("hello", "world"), "front")).toBeNull();
    expect(readingForCard(card("𠀀", "an uncommon character"), null)).toBeNull();
    expect(readingForCard(card("你好𠀀", "partly unsupported"), null)).toBeNull();
  });

  it("uses the configured side when both sides contain Chinese", () => {
    expect(pinyinTextForCard(card("你好", "您好"), "back")?.hanzi).toBe("您好");
    expect(pinyinTextForCard(card("你好", "您好"), null)?.hanzi).toBe("你好");
  });

  it("filters before batching, keeps due counts accurate, and leaves card data untouched", () => {
    const chinese = Array.from({ length: 30 }, (_, index) => card("你好", `meaning ${index}`, String(index)));
    const future = card("老师", "teacher", "future");
    future.fsrs.due = "2026-09-09T12:00:00.000Z";
    const cards = [card("hello", "world"), future, ...chinese];
    const before = JSON.stringify(cards);
    const result = buildPinyinQueueData(cards, "front", NOW);
    expect(result.totalDue).toBe(30);
    expect(result.queue).toHaveLength(25);
    expect(result.queue.every((item) => item.pinyin.syllables.join(" ") === "nǐ hǎo")).toBe(true);
    expect(JSON.stringify(cards)).toBe(before);
  });
});

describe("Pinyin answer checking", () => {
  it.each(["nǐ hǎo", "NǏ HǍO", "nǐhǎo", "ni3 hao3", "ni3hao3", "ni3-hǎo", "nǐ, hǎo!", "ni\u030c ha\u030co"])("accepts equivalent tone formats: %s", (input) => {
    expect(checkPinyinAnswer(input, ["nǐ", "hǎo"])).toBe(true);
  });

  it.each(["", "ni hao", "ni2 hao3", "ni3 hao2", "ni3 ha3", "n3i hao3", "你好", "ni3hao3x", "ni3ha9o3"])("rejects missing/wrong tones and invalid answers: %s", (input) => {
    expect(checkPinyinAnswer(input, ["nǐ", "hǎo"])).toBe(false);
  });

  it.each(["māma", "ma1 ma", "ma1ma0", "ma1 ma5"])("accepts neutral tone notation: %s", (input) => {
    expect(checkPinyinAnswer(input, ["mā", "ma"])).toBe(true);
  });

  it.each(["lǜ sè", "lü4 se4", "lv4se4", "lu:4 se4"])("accepts ü variants: %s", (input) => {
    expect(checkPinyinAnswer(input, ["lǜ", "sè"])).toBe(true);
  });

  it("keeps ü distinct from u", () => {
    expect(checkPinyinAnswer("lu4 se4", ["lǜ", "sè"])).toBe(false);
    expect(checkPinyinAnswer("lu se", ["lǜ", "sè"], false)).toBe(false);
  });

  it("accepts plain Pinyin only when tone checking is disabled", () => {
    expect(checkPinyinAnswer("ni hao", ["nǐ", "hǎo"], false)).toBe(true);
    expect(checkPinyinAnswer("nihao", ["nǐ", "hǎo"], false)).toBe(true);
    expect(checkPinyinAnswer("nǐ hǎo", ["nǐ", "hǎo"], false)).toBe(true);
    expect(checkPinyinAnswer("ni ha", ["nǐ", "hǎo"], false)).toBe(false);
    expect(checkPinyinAnswer("", ["nǐ", "hǎo"], false)).toBe(false);
  });

  it("requires a single consistent tone per syllable", () => {
    expect(checkPinyinAnswer("nǐ2 hǎo", ["nǐ", "hǎo"])).toBe(false);
    expect(checkPinyinAnswer("nǐ3 hǎo", ["nǐ", "hǎo"])).toBe(true);
    expect(checkPinyinAnswer("nǐ33 hǎo", ["nǐ", "hǎo"])).toBe(false);
  });

  it("displays a numbered answer without requiring a neutral-tone suffix", () => {
    expect(numberedPinyin(["nǐ", "hǎo", "ma"])).toBe("ni3 hao3 ma");
    expect(numberedPinyin(["lǜ", "sè"])).toBe("lü4 se4");
  });
});
