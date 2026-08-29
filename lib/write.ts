import type { Card, Deck } from "./types";

export type ChineseSide = "front" | "back";

export function isChineseLang(lang: string | undefined): boolean {
  return !!lang && lang.replace("_", "-").toLowerCase().startsWith("zh");
}

/**
 * Which side of this deck's cards holds the Chinese text.
 * Prefers the configured speech languages, then the explicit chineseSide
 * setting; null means we don't know and must ask.
 */
export function chineseSideForDeck(
  deck: Pick<Deck, "frontLanguage" | "backLanguage" | "chineseSide">
): ChineseSide | null {
  if (isChineseLang(deck.frontLanguage)) return "front";
  if (isChineseLang(deck.backLanguage)) return "back";
  return deck.chineseSide ?? null;
}

/** CJK unified ideographs (incl. extension A) — good enough to spot hanzi. */
export function hasChinese(text: string): boolean {
  return /[一-鿿㐀-䶿]/.test(text);
}

/**
 * Chinese side for one card. Decks often contain both directions (你好→hello
 * and hello→你好), so per-card script detection comes first; the deck-level
 * side only decides ambiguous cards (both or neither side containing hanzi).
 */
export function chineseSideForCard(
  card: Pick<Card, "front" | "back">,
  deckSide: ChineseSide | null
): ChineseSide | null {
  const front = hasChinese(card.front);
  const back = hasChinese(card.back);
  if (front && !back) return "front";
  if (back && !front) return "back";
  return deckSide;
}

export type WritePrompt = {
  /** Shown to the user (the non-Chinese side). */
  prompt: string;
  /** Expected typed answer (the Chinese side). */
  answer: string;
  notes?: string;
};

export function toWritePrompt(card: Card, chineseSide: ChineseSide): WritePrompt {
  return chineseSide === "front"
    ? { prompt: card.back, answer: card.front, notes: card.notes }
    : { prompt: card.front, answer: card.back, notes: card.notes };
}

/** Trim and collapse whitespace; typing "老师" should match "老师 " or " 老 师". */
export function normalizeAnswer(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function checkAnswer(input: string, expected: string): boolean {
  const a = normalizeAnswer(input);
  const b = normalizeAnswer(expected);
  if (a === b) return true;
  // Also accept answers that only differ by internal spacing (老 师 vs 老师).
  return a.replace(/ /g, "") === b.replace(/ /g, "") && a !== "";
}

export type DiffChar = { char: string; ok: boolean };

/**
 * Character-level diff (LCS) for showing a wrong answer against the expected
 * one, Anki-style: typed chars that match are ok, others are wrong; expected
 * chars the user missed are flagged on the answer line.
 */
export function diffChars(
  typed: string,
  expected: string
): { typed: DiffChar[]; expected: DiffChar[] } {
  const a = [...normalizeAnswer(typed)];
  const b = [...normalizeAnswer(expected)];
  const m = a.length;
  const n = b.length;
  // LCS length table (answers are short, so O(m*n) is fine).
  const lcs: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0)
  );
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      lcs[i][j] =
        a[i] === b[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const typedOut: DiffChar[] = [];
  const expectedOut: DiffChar[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      typedOut.push({ char: a[i], ok: true });
      expectedOut.push({ char: b[j], ok: true });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      typedOut.push({ char: a[i], ok: false });
      i++;
    } else {
      expectedOut.push({ char: b[j], ok: false });
      j++;
    }
  }
  while (i < m) typedOut.push({ char: a[i++], ok: false });
  while (j < n) expectedOut.push({ char: b[j++], ok: false });
  return { typed: typedOut, expected: expectedOut };
}
