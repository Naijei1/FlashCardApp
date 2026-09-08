// Server-only by import convention: do not import this dictionary module from
// a client component. lib/pinyin.ts contains the small client-side checker.
import { pinyin } from "pinyin-pro";
import { dueCards } from "./due";
import { buildReviewQueueData } from "./review-queue";
import { pinyinTextForCard, type PinyinReading } from "./pinyin";
import type { Card } from "./types";
import type { ChineseSide } from "./write";

export function readingForCard(card: Card, deckSide: ChineseSide | null): PinyinReading | null {
  const text = pinyinTextForCard(card, deckSide);
  if (!text) return null;
  const syllables = pinyin(text.hanzi, {
    type: "array",
    nonZh: "removed",
    toneSandhi: false,
    traditional: true,
  });
  // Do not grade a partial pronunciation if the dictionary lacks a character.
  if (syllables.length !== [...text.hanzi.replace(/\s/g, "")].length) return null;
  return { ...text, syllables };
}

export function buildPinyinQueueData(
  cards: Card[],
  deckSide: ChineseSide | null,
  now = new Date()
) {
  const readings = new Map<Card, PinyinReading>();
  for (const card of dueCards(cards, now)) {
    const reading = readingForCard(card, deckSide);
    if (reading) readings.set(card, reading);
  }
  const data = buildReviewQueueData([...readings.keys()], now);
  return {
    ...data,
    queue: data.queue.map((item) => ({ ...item, pinyin: readings.get(item.card)! })),
  };
}
