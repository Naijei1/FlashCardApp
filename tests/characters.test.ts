import { expect, it } from "vitest";
import {
  characterPartition,
  headwordForCharacter,
  indexedCharacters,
  isHanzi,
  MAX_INDEXED_CHARS,
  planIndexWrites,
  selectLookupWords,
} from "@/lib/characters";
import { readingForHeadword } from "@/lib/character-lookup";

it("accepts one ideograph and ignores latin, tone marks, and empty text", () => {
  expect(isHanzi("学")).toBe(true);
  expect(isHanzi("〇")).toBe(true);
  expect(isHanzi("a")).toBe(false);
  expect(isHanzi("学习")).toBe(false);
  expect(isHanzi("")).toBe(false);
});

it("indexes each ideograph once, front before back, and caps long text", () => {
  expect(indexedCharacters("学习 学", "学生")).toEqual(["学", "习", "生"]);
  const many = Array.from({ length: MAX_INDEXED_CHARS + 5 }, (_, index) => String.fromCodePoint(0x4e00 + index)).join("");
  expect(indexedCharacters(many, "")).toHaveLength(MAX_INDEXED_CHARS);
});

it("uses the Chinese side as the headword and strips a trailing reading", () => {
  expect(headwordForCharacter({ front: "老师 lǎo shī", back: "teacher" }, "师")).toEqual({
    hanzi: "老师",
    meaning: "teacher",
  });
  expect(headwordForCharacter({ front: "hello", back: "你好" }, "你")).toEqual({
    hanzi: "你好",
    meaning: "hello",
  });
  expect(headwordForCharacter({ front: "学习中文的方法", back: "学生" }, "学")).toEqual({
    hanzi: "学生",
    meaning: "学习中文的方法",
  });
  expect(headwordForCharacter({ front: "hello", back: "hi" }, "学")).toBeNull();
});

it("excludes the current card, sorts shorter words first, and limits the list", () => {
  const cards = [
    { deckId: "deck", cardId: "current", front: "学习", back: "to study" },
    { deckId: "deck", cardId: "long", front: "我正在学习中文", back: "I am studying Chinese" },
    { deckId: "other", cardId: "school", front: "学校", back: "school" },
    { deckId: "other", cardId: "student", front: "student", back: "学生" },
  ];
  const selected = selectLookupWords(cards, "学", { exclude: { deckId: "deck", cardId: "current" }, limit: 2 });
  expect(selected.total).toBe(3);
  expect(selected.words.map((word) => word.hanzi)).toEqual(["学生", "学校"]);
  expect(selected.words[0].meaning).toBe("student");
});

it("plans puts for new characters and deletes for ones that left the card", () => {
  const writes = planIndexWrites({
    scope: { kind: "private", userId: "user-1" },
    deckId: "deck-1",
    cardId: "card-1",
    front: "学习",
    back: "to study",
    updatedAt: "2026-10-25T00:00:00.000Z",
    previousFront: "学生",
    previousBack: "student",
  });
  expect(writes).toEqual([
    { op: "delete", pk: "CIDX#U#user-1#生", sk: "card-1" },
    {
      op: "put",
      pk: "CIDX#U#user-1#学",
      sk: "card-1",
      deckId: "deck-1",
      cardId: "card-1",
      front: "学习",
      back: "to study",
      updatedAt: "2026-10-25T00:00:00.000Z",
    },
    {
      op: "put",
      pk: "CIDX#U#user-1#习",
      sk: "card-1",
      deckId: "deck-1",
      cardId: "card-1",
      front: "学习",
      back: "to study",
      updatedAt: "2026-10-25T00:00:00.000Z",
    },
  ]);
  expect(characterPartition({ kind: "global" }, "学")).toBe("CIDX#G#学");
  expect(characterPartition({ kind: "legacy" }, "学")).toBe("CIDX#L#学");
  expect(planIndexWrites({
    scope: { kind: "legacy" },
    deckId: "deck-1",
    cardId: "card-1",
    front: "hello",
    back: "hi",
    updatedAt: "2026-10-25T00:00:00.000Z",
  })).toEqual([]);
});

it("adds an optional reading for the headword", () => {
  expect(readingForHeadword("学习")).toBe("xué xí");
  expect(readingForHeadword("hello")).toBeUndefined();
});
