// Server-only by import convention: this pulls in the pinyin dictionary.
import { polyphonic } from "pinyin-pro";
import { DEFAULT_BACK_LANG, DEFAULT_FRONT_LANG } from "./languages";
import { checkPinyinAnswer, numberedPinyin } from "./pinyin";
import { readingForCard } from "./pinyin-queue";
import { compareLessons } from "./practice-groups";
import type { Card, Deck } from "./types";
import { chineseSideForCard, chineseSideForDeck, chineseTextAndAnnotations, hasChinese, type ChineseSide } from "./write";

/**
 * One deduplicated card in a cram session. Only display fields cross to the
 * client: no FSRS state, progress, or review version.
 */
export type CramCard = {
  /** Dedup identity, stable across sessions. */
  key: string;
  id: string;
  deckId: string;
  prompt: string;
  promptLang: string;
  /** Tone-marked reading, when the card has gradable hanzi. */
  pinyin?: string;
  answer: string;
  answerLang: string;
  notes?: string;
  /** Lesson names containing this word, earliest first. */
  sources: string[];
};

/** Chinese text with whitespace, punctuation, and romanization stripped. */
export function normalizeChineseText(text: string): string {
  return chineseTextAndAnnotations(text.normalize("NFKC"))
    .text.replace(/[\s\p{P}\p{S}]/gu, "")
    .toLowerCase();
}

/**
 * Tone-numbered, lowercase, ü-as-v reading, so "Lǎo shī", "lao3 shi1", and
 * "lǎoshī" compare equal. Neutral tones carry no number.
 */
export function normalizePinyin(syllables: readonly string[]): string {
  return numberedPinyin([...syllables])
    .toLowerCase()
    .replace(/ü/g, "v")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

/** Loose side text for cards with no Chinese, so exact repeats still merge. */
function normalizeLoose(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, " ").trim();
}

const MAX_CANDIDATES = 256;

/** Letters only: no tones, digits, spaces, or apostrophes. ü and v compare equal. */
function pinyinBase(text: string): string {
  return text.normalize("NFD").toLowerCase().replace(/u\u0308|u:/g, "v").replace(/[^a-z]/g, "");
}

const candidateCache = new Map<string, Map<string, string[][]>>();

/** Every valid reading for these characters, grouped by toneless spelling. */
function candidateReadings(hanzi: string): Map<string, string[][]> {
  const cached = candidateCache.get(hanzi);
  if (cached) return cached;
  const byBase = new Map<string, string[][]>();
  const choices = polyphonic(hanzi, { type: "array", traditional: true }) as string[][];
  let out: string[][] = [[]];
  if (choices.length === 0 || choices.some((options) => options.length === 0)) out = [];
  for (const options of choices) {
    const next: string[][] = [];
    for (const prefix of out) for (const option of options) next.push([...prefix, option]);
    out = next.length > MAX_CANDIDATES ? [] : next;
    if (out.length === 0) break;
  }
  for (const candidate of out) {
    const base = pinyinBase(candidate.join(""));
    byBase.set(base, [...(byBase.get(base) ?? []), candidate]);
  }
  if (candidateCache.size >= 10_000) candidateCache.clear();
  candidateCache.set(hanzi, byBase);
  return byBase;
}

// Text is NFD-normalized first, so tone marks and ü are combining marks.
const PINYIN_TOKEN = /[a-z][a-z\u0300-\u036f]*[0-5]?/giu;
const HAS_TONE = /[\u0300\u0301\u0304\u030c0-5]/u;

/**
 * A reading the author wrote anywhere on the card, e.g. "行 — háng, row" or
 * "行 / xing2". Only a toned reading that is valid for these characters counts,
 * so English words in a gloss cannot pass as pinyin.
 */
export function suppliedReading(hanzi: string, texts: readonly string[]): string[] | null {
  const compact = hanzi.replace(/\s/g, "");
  if (!compact) return null;
  const candidates = candidateReadings(compact);
  if (candidates.size === 0) return null;
  for (const text of texts) {
    const tokens = text.normalize("NFD").match(PINYIN_TOKEN) ?? [];
    for (let start = 0; start < tokens.length; start++) {
      for (let size = 1; size <= compact.length && start + size <= tokens.length; size++) {
        const window = tokens.slice(start, start + size).join(" ");
        if (!HAS_TONE.test(window)) continue;
        const match = candidates.get(pinyinBase(window))?.find((candidate) => checkPinyinAnswer(window, candidate));
        if (match) return match;
      }
    }
  }
  return null;
}

type Resolved = {
  key: string;
  card: Card;
  chineseOnFront: boolean;
  view: Omit<CramCard, "key" | "sources">;
};

function resolveCard(card: Card, deck: Deck | undefined): Resolved {
  const deckSide: ChineseSide | null = deck ? chineseSideForDeck(deck) : null;
  const frontLang = deck?.frontLanguage || DEFAULT_FRONT_LANG;
  const backLang = deck?.backLanguage || DEFAULT_BACK_LANG;
  const base = { id: card.id, deckId: card.deckId, ...(card.notes ? { notes: card.notes } : {}) };
  if (!hasChinese(card.front) && !hasChinese(card.back)) {
    const sides = [normalizeLoose(card.front), normalizeLoose(card.back)].sort();
    return {
      key: JSON.stringify(["text", ...sides]),
      card,
      chineseOnFront: false,
      view: { ...base, prompt: card.front, promptLang: frontLang, answer: card.back, answerLang: backLang },
    };
  }
  const side = chineseSideForCard(card, deckSide) ?? "front";
  const other: ChineseSide = side === "front" ? "back" : "front";
  const chineseText = chineseTextAndAnnotations(card[side]).text || card[side];
  const hanziKey = normalizeChineseText(card[side]);
  const dictionary = readingForCard(card, deckSide);
  const { annotations } = chineseTextAndAnnotations(card[side]);
  // Prefer a reading the author wrote, on either side, over the dictionary default.
  const supplied = dictionary
    ? suppliedReading(dictionary.hanzi, [...annotations, card[other], card.notes ?? ""])
    : null;
  const syllables = supplied ?? dictionary?.syllables ?? null;
  const pinyinKey = syllables ? normalizePinyin(syllables) : "";
  return {
    key: JSON.stringify(["zh", hanziKey, pinyinKey]),
    card,
    chineseOnFront: side === "front",
    view: {
      ...base,
      prompt: chineseText,
      promptLang: side === "front" ? (frontLang.startsWith("zh") ? frontLang : "zh-CN") : (backLang.startsWith("zh") ? backLang : "zh-CN"),
      ...(syllables ? { pinyin: syllables.join(" ") } : {}),
      answer: card[other],
      answerLang: side === "front" ? backLang : frontLang,
    },
  };
}

export type CramEntry = {
  key: string;
  /** The copy shown: earliest lesson, Chinese-first direction. */
  card: Card;
  /** Every merged copy, `card` first. Ratings in a group apply to all of them. */
  copies: Card[];
  view: CramCard;
};

/**
 * Merge a group's cards into one cram set. The same Chinese text with the same
 * reading appears once, keeping the copy from the earliest lesson (and, within
 * a lesson, the Chinese-first direction). The same hanzi with a different
 * reading stays separate. Callers pass already release-gated, unhidden cards.
 */
export function mergeCramEntries(cards: readonly Card[], decks: readonly Deck[]): CramEntry[] {
  const ordered = [...decks].sort(compareLessons);
  const rank = new Map(ordered.map((deck, index) => [deck.id, index]));
  const deckById = new Map(decks.map((deck) => [deck.id, deck]));
  const resolved = cards
    .filter((card) => rank.has(card.deckId))
    .map((card) => resolveCard(card, deckById.get(card.deckId)))
    .sort((a, b) =>
      rank.get(a.card.deckId)! - rank.get(b.card.deckId)! ||
      Number(b.chineseOnFront) - Number(a.chineseOnFront) ||
      a.card.createdAt.localeCompare(b.card.createdAt) ||
      a.card.id.localeCompare(b.card.id)
    );
  const byKey = new Map<string, { keep: Resolved; copies: Card[]; deckIds: Set<string> }>();
  for (const entry of resolved) {
    const existing = byKey.get(entry.key);
    if (existing) {
      existing.deckIds.add(entry.card.deckId);
      existing.copies.push(entry.card);
    } else byKey.set(entry.key, { keep: entry, copies: [entry.card], deckIds: new Set([entry.card.deckId]) });
  }
  return [...byKey.values()].map(({ keep, copies, deckIds }) => ({
    key: keep.key,
    card: keep.card,
    copies,
    view: {
      key: keep.key,
      ...keep.view,
      sources: ordered.filter((deck) => deckIds.has(deck.id)).map((deck) => deck.name),
    },
  }));
}

/** Display-only cram cards: no FSRS state, progress, or review version. */
export function buildCramCards(cards: readonly Card[], decks: readonly Deck[]): CramCard[] {
  return mergeCramEntries(cards, decks).map((entry) => entry.view);
}
