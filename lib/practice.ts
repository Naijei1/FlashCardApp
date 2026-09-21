import type { Card } from "./types";
import { applyRating, type Grade } from "./fsrs";
import { localDateKey } from "./forecast";
import { wordKey } from "./words";

export const WEEKLY_WORD_GOAL = 77;
export const DAILY_WORD_GOAL = 11;

/** One attempted recall updates memory once; correction copies are not new reviews. */
export function rateCard(card: Card, rating: Grade, now: Date) {
  const result = applyRating(card.fsrs, rating, now);
  const previous = card.practice;
  return {
    ...result,
    card: {
      ...card,
      fsrs: result.fsrs,
      updatedAt: now.toISOString(),
      practice: {
        failures: (previous?.failures ?? card.fsrs.lapses) + (rating === 1 ? 1 : 0),
        successes: (previous?.successes ?? 0) + (rating >= 3 ? 1 : 0),
        correctStreak: rating >= 3 ? (previous?.correctStreak ?? 0) + 1 : 0,
        ...(previous?.firstStudiedAt
          ? { firstStudiedAt: previous.firstStudiedAt }
          : card.fsrs.reps === 0 ? { firstStudiedAt: now.toISOString() } : {}),
      },
    } satisfies Card,
  };
}

/** New words introduced, not a claim that a word has already been memorized. */
export function weeklyProgress(cards: Card[], now: Date, timeZone: string) {
  const today = localDateKey(now, timeZone);
  const date = new Date(`${today}T12:00:00Z`);
  const day = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - day);
  const monday = date.toISOString().slice(0, 10);
  const firstByWord = new Map<string, string>();
  for (const card of cards) {
    const at = [card.practice?.firstStudiedAt, card.modes?.write?.practice?.firstStudiedAt,
      card.modes?.pinyin?.practice?.firstStudiedAt].filter((at): at is string => !!at && Number.isFinite(Date.parse(at))).sort()[0];
    const key = wordKey(card);
    if (at && (!firstByWord.has(key) || at < firstByWord.get(key)!)) firstByWord.set(key, at);
  }
  const studied = [...firstByWord.values()].map((at) => localDateKey(new Date(at), timeZone));
  return {
    today: studied.filter((at) => at === today).length,
    week: studied.filter((at) => at >= monday && at <= today).length,
  };
}
