import { describe, expect, it } from "vitest";
import { buildCramCards, normalizeChineseText, normalizePinyin, suppliedReading } from "@/lib/cram";
import { emptyCardState } from "@/lib/fsrs";
import { compareLessons, resolveGroupDecks } from "@/lib/practice-groups";
import type { Card, Deck } from "@/lib/types";

const at = "2026-10-01T00:00:00.000Z";

function deck(id: string, name: string, extra: Partial<Deck> = {}): Deck {
  return { id, name, createdAt: at, updatedAt: at, frontLanguage: "zh-CN", backLanguage: "en-US", source: "global", ...extra };
}

let seq = 0;
function card(deckId: string, front: string, back: string, extra: Partial<Card> = {}): Card {
  seq += 1;
  return {
    id: `c${String(seq).padStart(3, "0")}`,
    deckId,
    front,
    back,
    createdAt: at,
    updatedAt: at,
    fsrs: { ...emptyCardState(new Date(at)), reps: 3, stability: 7 },
    ...extra,
  };
}

const l6 = deck("l6", "Lesson 6", { releaseWeek: 6 });
const l8 = deck("l8", "Lesson 8", { releaseWeek: 8 });
const l10 = deck("l10", "Lesson 10", { releaseWeek: 10 });

describe("normalization", () => {
  it("ignores whitespace, punctuation, and romanization in Chinese text", () => {
    expect(normalizeChineseText(" 老 师！")).toBe("老师");
    expect(normalizeChineseText("老师 lǎo shī")).toBe("老师");
    expect(normalizeChineseText("老师 (lao3 shi1)")).toBe("老师");
    expect(normalizeChineseText("你好，")).toBe(normalizeChineseText("你好"));
  });

  it("treats tone marks, tone numbers, and case the same", () => {
    expect(normalizePinyin(["Lǎo", "shī"])).toBe("lao3 shi1");
    expect(normalizePinyin(["lao3", "shi1"])).toBe("lao3 shi1");
    expect(normalizePinyin(["nǚ"])).toBe(normalizePinyin(["nv3"]));
    expect(normalizePinyin(["ma"])).toBe("ma");
  });

  it("finds a toned reading the author wrote on the meaning side, but not English words", () => {
    expect(suppliedReading("行", ["row; háng"])).toEqual(["háng"]);
    expect(suppliedReading("行", ["hang2 — a row"])).toEqual(["háng"]);
    expect(suppliedReading("行", ["to walk"])).toBeNull();
    expect(suppliedReading("老师", ["teacher (lǎoshī)"])).toEqual(["lǎo", "shī"]);
  });
});

describe("buildCramCards", () => {
  it("shows a word repeated across lessons once, from the earliest lesson, with its sources", () => {
    const cards = [
      card("l10", "老师！", "teacher"),
      card("l8", "老师 lǎo shī", "teacher (again)"),
      card("l6", " 老师", "teacher"),
      card("l8", "学生", "student"),
    ];
    const out = buildCramCards(cards, [l10, l8, l6]);
    const teacher = out.filter((item) => item.prompt.includes("老师"));
    expect(teacher).toHaveLength(1);
    expect(teacher[0].deckId).toBe("l6");
    expect(teacher[0].sources).toEqual(["Lesson 6", "Lesson 8", "Lesson 10"]);
    expect(teacher[0].pinyin).toBe("lǎo shī");
    expect(out).toHaveLength(2);
  });

  it("keeps the same hanzi with a different reading as separate cards", () => {
    const cards = [
      card("l6", "行 (xíng)", "to walk; OK"),
      card("l8", "行 (háng)", "row; line"),
      card("l10", "行", "háng — profession"),
      card("l10", "行", "OK"),
    ];
    const out = buildCramCards(cards, [l6, l8, l10]);
    const readings = out.map((item) => item.pinyin).sort();
    expect(readings).toEqual(["háng", "xíng"]);
    expect(out.find((item) => item.pinyin === "háng")?.sources).toEqual(["Lesson 8", "Lesson 10"]);
    expect(out.find((item) => item.pinyin === "xíng")?.sources).toEqual(["Lesson 6", "Lesson 10"]);
  });

  it("merges a reversed pair and keeps the Chinese-first copy", () => {
    const reverse = card("l6", "hello", "你好");
    const forward = card("l6", "你好", "hello");
    const out = buildCramCards([reverse, forward], [l6]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(forward.id);
    expect(out[0].prompt).toBe("你好");
    expect(out[0].answer).toBe("hello");
  });

  it("merges exact repeats of non-Chinese cards and leaves different ones apart", () => {
    const en = deck("en", "Vocab", { frontLanguage: "en-US", backLanguage: "es-ES", source: "private" });
    const out = buildCramCards([
      card("en", "Dog", "perro"),
      card("en", "dog ", "Perro"),
      card("en", "cat", "gato"),
    ], [en]);
    expect(out).toHaveLength(2);
  });

  it("sends display fields only, never scheduling state", () => {
    const out = buildCramCards([card("l6", "你好", "hello", { hard: true, notes: "greeting" })], [l6]);
    expect(Object.keys(out[0]).sort()).toEqual(
      ["answer", "answerLang", "deckId", "id", "key", "notes", "pinyin", "prompt", "promptLang", "sources"].sort()
    );
    expect(JSON.stringify(out)).not.toContain("stability");
  });

  it("drops cards whose lesson is not part of the resolved group", () => {
    const out = buildCramCards([card("l6", "你", "you"), card("gone", "他", "he")], [l6]);
    expect(out.map((item) => item.prompt)).toEqual(["你"]);
  });
});

describe("lesson order", () => {
  it("orders by release week, then numeric name", () => {
    const a = deck("a", "Lesson 10");
    const b = deck("b", "Lesson 6");
    expect([a, b].sort(compareLessons).map((d) => d.id)).toEqual(["b", "a"]);
    expect([l10, l6, l8].sort(compareLessons).map((d) => d.id)).toEqual(["l6", "l8", "l10"]);
  });

  it("skips saved lessons that are no longer visible and counts them", () => {
    const result = resolveGroupDecks({ deckIds: ["l10", "deleted", "l6"] }, [l6, l8, l10]);
    expect(result.decks.map((d) => d.id)).toEqual(["l6", "l10"]);
    expect(result.missing).toBe(1);
  });
});

describe("lessonSections", () => {
  it("splits shared and personal lessons with labels, and leaves legacy decks unlabeled", async () => {
    const { lessonSections } = await import("@/lib/practice-groups");
    const mine = deck("p1", "My words", { source: "private" });
    const sections = lessonSections([l10, mine, l6], new Map([["l6", 4]]), (d) => d.source === "private" ? "Private" : "Shared");
    expect(sections.map((s) => [s.title, s.lessons.map((l) => l.id)])).toEqual([
      ["Shared lessons", ["l6", "l10"]],
      ["Your decks", ["p1"]],
    ]);
    expect(sections[0].lessons[0]).toMatchObject({ cards: 4, kicker: "Shared" });
    const legacy = lessonSections([deck("a", "A", { source: undefined })], new Map(), () => "Shared");
    expect(legacy[0].lessons[0].kicker).toBeUndefined();
  });
});
