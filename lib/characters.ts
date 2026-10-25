import { chineseTextAndAnnotations, hasChinese } from "./write";

/** Ideographs learners can tap, including the 〇 placeholder used on some cards. */
const HANZI = /[\p{Unified_Ideograph}〇]/u;

export const MAX_INDEXED_CHARS = 80;
export const LOOKUP_WORD_LIMIT = 100;

export type IndexScope =
  | { kind: "legacy" }
  | { kind: "global" }
  | { kind: "private"; userId: string };

export type IndexedCard = {
  deckId: string;
  cardId: string;
  front: string;
  back: string;
};

export type LookupWord = {
  deckId: string;
  cardId: string;
  hanzi: string;
  meaning: string;
  pinyin?: string;
};

export function isHanzi(char: string): boolean {
  return HANZI.test(char) && [...char].length === 1;
}

/** Unique ideographs in reading order, capped so one card cannot fan out forever. */
export function indexedCharacters(front: string, back: string): string[] {
  const seen = new Set<string>();
  const characters: string[] = [];
  for (const char of `${front}\n${back}`.normalize("NFC")) {
    if (!isHanzi(char) || seen.has(char)) continue;
    seen.add(char);
    characters.push(char);
    if (characters.length >= MAX_INDEXED_CHARS) break;
  }
  return characters;
}

export function characterPartition(scope: IndexScope, character: string): string {
  if (scope.kind === "legacy") return `CIDX#L#${character}`;
  if (scope.kind === "global") return `CIDX#G#${character}`;
  return `CIDX#U#${scope.userId}#${character}`;
}

function hanziCount(text: string): number {
  return text.match(/[\p{Unified_Ideograph}〇]/gu)?.length ?? 0;
}

/** Chinese headword with annotations such as trailing pinyin removed. */
function phrase(text: string): string {
  if (!hasChinese(text)) return text.replace(/\s+/g, " ").trim();
  const cleaned = chineseTextAndAnnotations(text).text;
  const parts = cleaned.match(/[\p{Unified_Ideograph}〇]+/gu);
  return parts?.join("") || cleaned.replace(/\s+/g, " ").trim();
}

function meaningText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Chinese side that contains the character, with the other side as the meaning.
 * When both sides contain it, the shorter Chinese side is the headword.
 */
export function headwordForCharacter(
  card: Pick<IndexedCard, "front" | "back">,
  character: string
): { hanzi: string; meaning: string } | null {
  const frontHas = card.front.includes(character);
  const backHas = card.back.includes(character);
  if (!frontHas && !backHas) return null;
  const useBack =
    (backHas && !frontHas) ||
    (frontHas && backHas && hanziCount(card.back) < hanziCount(card.front));
  const hanzi = phrase(useBack ? card.back : card.front);
  const meaning = meaningText(useBack ? card.front : card.back);
  if (!hanzi.includes(character)) return null;
  return { hanzi, meaning };
}

export function selectLookupWords(
  cards: readonly IndexedCard[],
  character: string,
  options: { exclude?: { deckId: string; cardId: string }; limit?: number } = {}
): { words: LookupWord[]; total: number } {
  const limit = options.limit ?? LOOKUP_WORD_LIMIT;
  const seen = new Set<string>();
  const words: LookupWord[] = [];
  for (const card of cards) {
    if (options.exclude && card.deckId === options.exclude.deckId && card.cardId === options.exclude.cardId) {
      continue;
    }
    const key = `${card.deckId}\u0000${card.cardId}`;
    if (seen.has(key)) continue;
    const word = headwordForCharacter(card, character);
    if (!word) continue;
    seen.add(key);
    words.push({ deckId: card.deckId, cardId: card.cardId, ...word });
  }
  words.sort(
    (a, b) =>
      [...a.hanzi].length - [...b.hanzi].length ||
      a.hanzi.localeCompare(b.hanzi, "zh") ||
      a.meaning.localeCompare(b.meaning) ||
      a.deckId.localeCompare(b.deckId) ||
      a.cardId.localeCompare(b.cardId)
  );
  return { words: words.slice(0, limit), total: words.length };
}

export type IndexWrite =
  | { op: "delete"; pk: string; sk: string }
  | {
      op: "put";
      pk: string;
      sk: string;
      deckId: string;
      cardId: string;
      front: string;
      back: string;
      updatedAt: string;
    };

export function planIndexWrites(input: {
  scope: IndexScope;
  deckId: string;
  cardId: string;
  front: string;
  back: string;
  updatedAt: string;
  previousFront?: string;
  previousBack?: string;
}): IndexWrite[] {
  if (!input.cardId || !input.deckId) return [];
  const next = new Set(indexedCharacters(input.front, input.back));
  const previous = indexedCharacters(input.previousFront ?? "", input.previousBack ?? "");
  const writes: IndexWrite[] = [];
  for (const char of previous) {
    if (next.has(char)) continue;
    writes.push({ op: "delete", pk: characterPartition(input.scope, char), sk: input.cardId });
  }
  for (const char of next) {
    writes.push({
      op: "put",
      pk: characterPartition(input.scope, char),
      sk: input.cardId,
      deckId: input.deckId,
      cardId: input.cardId,
      front: input.front,
      back: input.back,
      updatedAt: input.updatedAt,
    });
  }
  return writes;
}
