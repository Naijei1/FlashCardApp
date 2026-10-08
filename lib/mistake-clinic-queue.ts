import { shuffle } from "./due";
import { cardForMode } from "./modes";
import { MISTAKE_CLINIC_LIMIT, weakWords } from "./mistake-clinic";
import { studyDetails } from "./pinyin-queue";
import type { StudyQueueItem } from "./review-queue";
import type { Card, ReviewMode } from "./types";
import type { ChineseSide } from "./write";

export type MistakeClinicQueueItem = StudyQueueItem & {
  mode: ReviewMode;
  weaknessScore: number;
  weaknessReasons: string[];
};

export type MistakeClinicQueueData = {
  queue: MistakeClinicQueueItem[];
  totalWeak: number;
};

export function buildMistakeClinicQueue(
  cards: Card[],
  sideFor: (card: Card) => ChineseSide | null,
  now: Date = new Date(),
  options: { limit?: number; random?: () => number } = {}
): MistakeClinicQueueData {
  const { limit = MISTAKE_CLINIC_LIMIT, random = Math.random } = options;
  const words = weakWords(cards, { now });
  const items: MistakeClinicQueueItem[] = [];

  for (const word of words) {
    const sortedModes = [...word.modes].sort((a, b) => b.score - a.score || a.mode.localeCompare(b.mode));
    for (const weakMode of sortedModes) {
      const projected = cardForMode(word.card, weakMode.mode);
      const details = studyDetails(projected, weakMode.mode, sideFor(word.card));
      if (!details) continue;
      items.push({
        card: { ...projected, hard: word.hard || projected.hard },
        mode: weakMode.mode,
        weaknessScore: weakMode.score,
        weaknessReasons: weakMode.reasons,
        ...details,
      });
    }
  }

  const selected = items
    .sort((a, b) => b.weaknessScore - a.weaknessScore || a.card.updatedAt.localeCompare(b.card.updatedAt))
    .slice(0, limit);
  return {
    totalWeak: words.length,
    queue: shuffle(selected, random),
  };
}
