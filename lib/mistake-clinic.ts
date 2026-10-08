import { State } from "ts-fsrs";
import type { Card, ReviewMode, StoredFsrs } from "./types";
import { wordKey } from "./words";

export const MISTAKE_CLINIC_DECK = "mistake-clinic";
export const MISTAKE_CLINIC_LIMIT = 25;

type Practice = NonNullable<Card["practice"]>;

export type WeakMode = {
  mode: ReviewMode;
  score: number;
  reasons: string[];
};

export type WeakWord = {
  card: Card;
  key: string;
  score: number;
  modes: WeakMode[];
  hard: boolean;
};

export type WeakWordOptions = {
  now?: Date;
  threshold?: number;
};

const DEFAULT_THRESHOLD = 5;
const RECENT_LAPSE_WINDOW_MS = 14 * 86_400_000;

function modeState(card: Card, mode: ReviewMode): { fsrs: StoredFsrs; practice?: Practice } {
  if (mode === "review") return { fsrs: card.fsrs, practice: card.practice };
  const state = card.modes?.[mode];
  return state ? { fsrs: state.fsrs, practice: state.practice } : { fsrs: card.fsrs, practice: undefined };
}

function recentLapseScore(fsrs: StoredFsrs, now: Date): number {
  if (!fsrs.last_review || fsrs.lapses <= 0) return 0;
  const last = Date.parse(fsrs.last_review);
  if (!Number.isFinite(last)) return 0;
  const age = now.getTime() - last;
  if (age < 0 || age > RECENT_LAPSE_WINDOW_MS) return 0;
  return Math.max(1, Math.ceil(4 * (1 - age / RECENT_LAPSE_WINDOW_MS)));
}

function scoreMode(card: Card, mode: ReviewMode, hard: boolean, now: Date): WeakMode | null {
  if (mode !== "review" && !card.modes?.[mode]) {
    return hard ? { mode, score: 5, reasons: ["marked hard"] } : null;
  }
  const { fsrs, practice } = modeState(card, mode);
  const failures = practice?.failures ?? fsrs.lapses;
  const streak = practice?.correctStreak ?? 0;
  const reps = fsrs.reps;
  const reasons: string[] = [];
  let score = hard ? 5 : 0;
  if (hard) reasons.push("marked hard");

  if (failures > 0) {
    score += Math.min(failures, 8) * 3;
    reasons.push(failures === 1 ? "1 failure" : `${failures} failures`);
  }
  if (fsrs.lapses > 0) {
    score += Math.min(fsrs.lapses, 5) * 4;
    reasons.push(fsrs.lapses === 1 ? "1 lapse" : `${fsrs.lapses} lapses`);
  }
  if (reps > 0 && streak < 3) {
    score += (3 - streak) * 2;
    reasons.push(streak === 0 ? "no correct streak" : `${streak}-card streak`);
  }
  if (fsrs.state === State.Relearning) {
    score += 5;
    reasons.push("relearning");
  } else if (fsrs.state === State.Learning && reps > 0) {
    score += 2;
    reasons.push("still learning");
  }
  const recency = recentLapseScore(fsrs, now);
  if (recency > 0) {
    score += recency;
    reasons.push("recent lapse");
  }

  return score > 0 ? { mode, score, reasons } : null;
}

function strongerWord(left: Card, right: Card, hardKeys: Set<string>, now: Date): Card {
  const leftScore = scoreCard(left, hardKeys.has(wordKey(left)), now);
  const rightScore = scoreCard(right, hardKeys.has(wordKey(right)), now);
  return rightScore > leftScore ||
    (rightScore === leftScore && right.updatedAt.localeCompare(left.updatedAt) > 0)
    ? right
    : left;
}

function scoreCard(card: Card, hard: boolean, now: Date): number {
  return (["review", "write", "pinyin"] as const)
    .map((mode) => scoreMode(card, mode, hard, now)?.score ?? 0)
    .reduce((max, score) => Math.max(max, score), 0);
}

export function weakWords(cards: Card[], options: WeakWordOptions = {}): WeakWord[] {
  const now = options.now ?? new Date();
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const hardKeys = new Set(cards.filter((card) => card.hard).map(wordKey));
  const bestByWord = new Map<string, Card>();

  for (const card of cards) {
    const key = wordKey(card);
    const previous = bestByWord.get(key);
    bestByWord.set(key, previous ? strongerWord(previous, card, hardKeys, now) : card);
  }

  return [...bestByWord.entries()]
    .map(([key, card]) => {
      const hard = hardKeys.has(key);
      const modes = (["review", "write", "pinyin"] as const)
        .map((mode) => scoreMode(card, mode, hard, now))
        .filter((mode): mode is WeakMode => !!mode && mode.score >= threshold);
      return { card: hard ? { ...card, hard: true } : card, key, hard, modes, score: Math.max(0, ...modes.map((mode) => mode.score)) };
    })
    .filter((word) => word.modes.length > 0)
    .sort((a, b) => b.score - a.score || b.card.updatedAt.localeCompare(a.card.updatedAt) || a.key.localeCompare(b.key));
}

export function weakWordCount(cards: Card[], options?: WeakWordOptions): number {
  return weakWords(cards, options).length;
}
