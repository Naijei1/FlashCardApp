import type { Card } from "./types";
import { chineseSideForCard, hasChinese, type ChineseSide } from "./write";

export type PinyinReading = {
  hanzi: string;
  meaning: string;
  syllables: string[];
};

/** Find real hanzi on either side; never treat an English-only card as Chinese. */
export function pinyinTextForCard(
  card: Pick<Card, "front" | "back">,
  deckSide: ChineseSide | null
): Pick<PinyinReading, "hanzi" | "meaning"> | null {
  if (!hasChinese(card.front) && !hasChinese(card.back)) return null;
  const side = chineseSideForCard(card, deckSide) ?? "front";
  const source = card[side];
  // Strip any existing romanization/English annotations so they do not reveal
  // the answer. Keep word boundaries for phrase-aware pronunciation lookup.
  const hanzi = source.match(/[\p{Unified_Ideograph}〇]+/gu)?.join(" ");
  if (!hanzi) return null;
  return { hanzi, meaning: side === "front" ? card.back : card.front };
}

type Letter = { base: string; tones: number[] };
type ParsedPinyin = { letters: Letter[]; endings: Map<number, number> };
const TONE_MARKS: Record<string, number> = {
  "\u0304": 1,
  "\u0301": 2,
  "\u030c": 3,
  "\u0300": 4,
};

/** Lightweight input parsing; the pronunciation dictionary stays on the server. */
function parsePinyin(input: string): ParsedPinyin | null {
  const letters: Letter[] = [];
  const endings = new Map<number, number>();
  const text = input.normalize("NFKC").toLowerCase().replace(/u:/g, "ü").replace(/v/g, "ü").normalize("NFD");
  for (const char of text) {
    if (/[a-z]/.test(char)) {
      letters.push({ base: char, tones: [] });
    } else if (char === "\u0308" || char === "\u0302") {
      const previous = letters.at(-1);
      if (!previous || previous.base !== (char === "\u0308" ? "u" : "e")) return null;
      previous.base = char === "\u0308" ? "ü" : "ê";
    } else if (TONE_MARKS[char]) {
      const previous = letters.at(-1);
      if (!previous) return null;
      previous.tones.push(TONE_MARKS[char]);
    } else if (/[0-5]/.test(char)) {
      if (letters.length === 0 || endings.has(letters.length)) return null;
      endings.set(letters.length, char === "5" ? 0 : Number(char));
    } else if (!/[\s'’\-·.,!?，。！？、;；]/.test(char)) {
      return null;
    }
  }
  return letters.length > 0 ? { letters, endings } : null;
}

function syllableParts(syllable: string): { base: string; tone: number } | null {
  const parsed = parsePinyin(syllable);
  if (!parsed) return null;
  const marks = parsed.letters.flatMap((letter) => letter.tones);
  return {
    base: parsed.letters.map((letter) => letter.base).join(""),
    tone: marks[0] ?? parsed.endings.get(parsed.letters.length) ?? 0,
  };
}

export function numberedPinyin(syllables: string[]): string {
  return syllables.map((syllable) => {
    const parsed = syllableParts(syllable);
    return parsed ? `${parsed.base}${parsed.tone || ""}` : syllable;
  }).join(" ");
}

/** Accept marked/numbered tones, joined words, neutral 0/5, and ü/v/u:. */
export function checkPinyinAnswer(
  input: string,
  syllables: string[],
  checkTones = true
): boolean {
  const typed = parsePinyin(input);
  if (!typed || syllables.length === 0) return false;
  const expected = syllables.map(syllableParts);
  if (expected.some((syllable) => !syllable)) return false;
  const typedBase = typed.letters.map((letter) => letter.base).join("");
  if (typedBase !== expected.map((syllable) => syllable!.base).join("")) return false;

  let position = 0;
  const boundaries = new Set<number>();
  for (const syllable of expected) {
    const end = position + syllable!.base.length;
    boundaries.add(end);
    const marks = typed.letters.slice(position, end).flatMap((letter) => letter.tones);
    const numberedTone = typed.endings.get(end);
    if (checkTones) {
      if (marks.length > 1) return false;
      if (marks.length && numberedTone !== undefined && marks[0] !== numberedTone) return false;
      if ((marks[0] ?? numberedTone ?? 0) !== syllable!.tone) return false;
    }
    position = end;
  }
  // A number must follow a whole syllable, even when tone checking is off.
  return [...typed.endings.keys()].every((boundary) => boundaries.has(boundary));
}
