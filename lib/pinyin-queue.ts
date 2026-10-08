// Server-only by import convention: do not import this dictionary module from
// a client component. lib/pinyin.ts contains the small client-side checker.
import { pinyin, polyphonic } from "pinyin-pro";
import { dueCards, isNew } from "./due";
import { buildReviewQueueData, type StudyQueueItem } from "./review-queue";
import { checkPinyinAnswer, pinyinTextForCard, type PinyinReading } from "./pinyin";
import type { Card, ReviewMode } from "./types";
import { chineseSideForCard, chineseTextAndAnnotations, type ChineseSide } from "./write";

const MAX_READING_CACHE_SIZE = 10_000;
const readingCache = new Map<string, PinyinReading | null>();

export function readingForCard(card: Card, deckSide: ChineseSide | null): PinyinReading | null {
  const text = pinyinTextForCard(card, deckSide);
  if (!text) return null;
  const side = chineseSideForCard(card, deckSide) ?? "front";
  const cacheKey = `${side}\u0000${card[side]}\u0000${text.hanzi}\u0000${text.meaning}`;
  if (readingCache.has(cacheKey)) return copyReading(readingCache.get(cacheKey) ?? null);
  const { annotations } = chineseTextAndAnnotations(card[side]);
  let reading: PinyinReading | null = null;
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
        reading = { ...text, syllables: supplied };
        break;
      }
    }
  }
  if (!reading) {
    const syllables = pinyin(text.hanzi, {
      type: "array",
      nonZh: "removed",
      toneSandhi: false,
      traditional: true,
    });
    // Do not grade a partial pronunciation if the dictionary lacks a character.
    if (syllables.length === [...text.hanzi.replace(/\s/g, "")].length) {
      reading = { ...text, syllables };
    }
  }
  if (readingCache.size >= MAX_READING_CACHE_SIZE) readingCache.clear();
  readingCache.set(cacheKey, reading);
  return copyReading(reading);
}

function copyReading(reading: PinyinReading | null): PinyinReading | null {
  return reading ? { ...reading, syllables: [...reading.syllables] } : null;
}

type StudyDetails = Omit<StudyQueueItem, "card">;

/** Reading and answer side for a card, or null when the skill cannot grade it. */
export function studyDetails(card: Card, mode: ReviewMode, deckSide: ChineseSide | null): StudyDetails | null {
  const pinyin = readingForCard(card, deckSide) ?? undefined;
  const chineseSide = chineseSideForCard(card, deckSide) ?? undefined;
  if (mode !== "review" && !pinyin) return null;
  if (mode === "write" && !chineseSide) return null;
  return { pinyin, chineseSide };
}

export type StudyQueueOptions = {
  mode: ReviewMode;
  /** Deck-level Chinese side for a card; virtual decks resolve each card's own deck. */
  sideFor: (card: Card) => ChineseSide | null;
  now?: Date;
  newOnly?: boolean;
  newLimit?: number;
};

/**
 * Due queue for one skill. Cards must already be projected with cardForMode.
 * Writing skills only include cards with a gradable reading, before batching,
 * so totals and batch boundaries describe what can actually be practiced.
 */
export function buildStudyQueue(cards: Card[], options: StudyQueueOptions): {
  queue: StudyQueueItem[];
  totalDue: number;
} {
  const { mode, sideFor, now = new Date(), newOnly = false } = options;
  const details = new Map<Card, StudyDetails>();
  for (const card of dueCards(cards, now)) {
    if (newOnly && !isNew(card)) continue;
    const detail = studyDetails(card, mode, sideFor(card));
    if (detail) details.set(card, detail);
  }
  const data = buildReviewQueueData([...details.keys()], now, {
    newLimit: newOnly ? undefined : options.newLimit,
  });
  return {
    totalDue: data.totalDue,
    queue: data.queue.map(({ card }) => ({ card, ...details.get(card) })),
  };
}
