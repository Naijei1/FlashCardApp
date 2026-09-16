// Server-only by import convention: do not import this dictionary module from
// a client component. lib/pinyin.ts contains the small client-side checker.
import { pinyin, polyphonic } from "pinyin-pro";
import { dueCards } from "./due";
import { buildReviewQueueData } from "./review-queue";
import { checkPinyinAnswer, pinyinTextForCard, type PinyinReading } from "./pinyin";
import type { Card } from "./types";
import { chineseSideForCard, chineseTextAndAnnotations, type ChineseSide } from "./write";

export function readingForCard(card: Card, deckSide: ChineseSide | null): PinyinReading | null {
  const text = pinyinTextForCard(card, deckSide);
  if (!text) return null;
  const side = chineseSideForCard(card, deckSide) ?? "front";
  const { annotations } = chineseTextAndAnnotations(card[side]);
  if (annotations.length > 0) {
    const choices = polyphonic(text.hanzi.replace(/\s/g, ""), {
      type: "array", traditional: true,
    });
    // Respect a complete pronunciation the author supplied, including an
    // alternate reading such as 行 (háng). Validate against each character's
    // readings so an English gloss or partial annotation cannot become an answer.
    for (const annotation of annotations) {
      const tokens = annotation.replace(/([0-5])(?=[a-zü])/giu, "$1 ").trim().split(/[\s'’\-]+/u);
      if (tokens.length !== choices.length) continue;
      const supplied = tokens.map((token, index) =>
        choices[index].find((option) => checkPinyinAnswer(token, [option]))
      );
      if (supplied.every((syllable): syllable is string => !!syllable)) {
        return { ...text, syllables: supplied };
      }
    }
  }
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
