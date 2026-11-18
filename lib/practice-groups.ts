import { DEFAULT_TARGET_RECALL, dayDiff, isValidDateKey, MAX_TARGET_RECALL, MIN_TARGET_RECALL, parseTargetRecall } from "./exam";
import { appTimeZone, localDateKey } from "./forecast";
import type { Deck } from "./types";
import { isRecord } from "./validation";

/**
 * A saved set of lessons a learner crams together, e.g. "Final: L6-10".
 * Stored per user next to their progress items. It holds deck ids only — card
 * content and release gating are resolved on every read.
 */
export type PracticeGroup = {
  id: string;
  name: string;
  deckIds: string[];
  /** Exam day as YYYY-MM-DD in the learner's local calendar. Optional. */
  examDate?: string;
  /** Recall the exam plan aims for on exam day. Absent means DEFAULT_TARGET_RECALL. */
  targetRecall?: number;
  createdAt: string;
  updatedAt: string;
};

/** "today" = due + new (the exam plan when dated); "all" = extra practice, every card once. */
export type GroupPlan = "today" | "all";

/** How far ahead an exam may be scheduled. */
export const MAX_EXAM_DAYS_AHEAD = 3 * 366;

export function groupTargetRecall(group: Pick<PracticeGroup, "targetRecall">): number {
  return parseTargetRecall(group.targetRecall) ?? DEFAULT_TARGET_RECALL;
}

export const MAX_GROUP_NAME_LENGTH = 80;
export const MAX_GROUP_DECKS = 100;
export const MAX_GROUPS_PER_USER = 50;

const GROUP_SK_PREFIX = "PRACTICE_GROUP#";

export function practiceGroupKey(userId: string, groupId: string): { PK: string; SK: string } {
  return { PK: `USER#${userId}`, SK: `${GROUP_SK_PREFIX}${groupId}` };
}

export function practiceGroupPrefix(userId: string): { PK: string; SK: string } {
  return { PK: `USER#${userId}`, SK: GROUP_SK_PREFIX };
}

/** Group ids are generated UUIDs; reject anything that could escape the key. */
export function isValidGroupId(id: string): boolean {
  return /^[A-Za-z0-9-]{1,64}$/.test(id);
}

export function groupFromItem(item: Record<string, unknown>): PracticeGroup | null {
  if (typeof item.SK !== "string" || !item.SK.startsWith(GROUP_SK_PREFIX)) return null;
  if (typeof item.name !== "string" || !Array.isArray(item.deckIds)) return null;
  return {
    id: item.SK.slice(GROUP_SK_PREFIX.length),
    name: item.name,
    deckIds: item.deckIds.filter((id): id is string => typeof id === "string"),
    ...(isValidDateKey(item.examDate) ? { examDate: item.examDate } : {}),
    ...(parseTargetRecall(item.targetRecall) !== null ? { targetRecall: parseTargetRecall(item.targetRecall)! } : {}),
    createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date(0).toISOString(),
    updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : new Date(0).toISOString(),
  };
}

/** `null` clears an optional field on update. */
export type GroupInput = {
  name: string;
  deckIds: string[];
  examDate?: string | null;
  targetRecall?: number | null;
};

/**
 * Validates a create/update body. `allowedDeckIds` is the caller's visible
 * deck list, so a group can never name an unreleased or foreign lesson.
 */
export function parseGroupInput(
  body: unknown,
  allowedDeckIds: ReadonlySet<string>,
  options: { partial?: boolean; today?: string } = {}
): { ok: true; value: Partial<GroupInput> } | { ok: false; error: string } {
  if (!isRecord(body)) return { ok: false, error: "invalid body" };
  const value: Partial<GroupInput> = {};
  if (body.name !== undefined || !options.partial) {
    const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
    if (!name) return { ok: false, error: "group name is required" };
    if (name.length > MAX_GROUP_NAME_LENGTH) return { ok: false, error: "group name is too long" };
    value.name = name;
  }
  if (body.deckIds !== undefined || !options.partial) {
    if (!Array.isArray(body.deckIds) || body.deckIds.some((id) => typeof id !== "string")) {
      return { ok: false, error: "deckIds must be a list of lesson ids" };
    }
    const deckIds = [...new Set(body.deckIds as string[])];
    if (deckIds.length === 0) return { ok: false, error: "pick at least one lesson" };
    if (deckIds.length > MAX_GROUP_DECKS) return { ok: false, error: "too many lessons" };
    if (deckIds.some((id) => !allowedDeckIds.has(id))) {
      return { ok: false, error: "a selected lesson is not available" };
    }
    value.deckIds = deckIds;
  }
  if (body.examDate !== undefined) {
    if (body.examDate === null || body.examDate === "") value.examDate = null;
    else {
      if (!isValidDateKey(body.examDate)) return { ok: false, error: "exam date must be a real date (YYYY-MM-DD)" };
      const today = options.today ?? localDateKey(new Date(), appTimeZone());
      const ahead = dayDiff(today, body.examDate);
      if (ahead < 0) return { ok: false, error: "exam date is in the past" };
      if (ahead > MAX_EXAM_DAYS_AHEAD) return { ok: false, error: "exam date is too far ahead" };
      value.examDate = body.examDate;
    }
  }
  if (body.targetRecall !== undefined) {
    if (body.targetRecall === null) value.targetRecall = null;
    else {
      const target = parseTargetRecall(body.targetRecall);
      if (target === null) {
        return { ok: false, error: `target recall must be between ${MIN_TARGET_RECALL} and ${MAX_TARGET_RECALL}` };
      }
      value.targetRecall = target;
    }
  }
  return { ok: true, value };
}

/**
 * Lesson order for "earliest lesson wins": release week first, then a natural
 * name sort so "Lesson 6" comes before "Lesson 10", then creation time.
 */
export function compareLessons(a: Deck, b: Deck): number {
  const weekA = typeof a.releaseWeek === "number" ? a.releaseWeek : Number.POSITIVE_INFINITY;
  const weekB = typeof b.releaseWeek === "number" ? b.releaseWeek : Number.POSITIVE_INFINITY;
  if (weekA !== weekB) return weekA - weekB;
  const byName = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  if (byName !== 0) return byName;
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

/**
 * Splits a saved selection into lessons the learner can still see and a count
 * of ones that were since hidden, archived, unpublished, or deleted.
 */
export function resolveGroupDecks(
  group: Pick<PracticeGroup, "deckIds">,
  visibleDecks: readonly Deck[]
): { decks: Deck[]; missing: number } {
  const byId = new Map(visibleDecks.map((deck) => [deck.id, deck]));
  const decks = group.deckIds.flatMap((id) => byId.get(id) ?? []);
  return { decks: decks.sort(compareLessons), missing: group.deckIds.length - decks.length };
}

export type LessonOption = { id: string; name: string; kicker?: string; cards: number };
export type LessonSection = { title: string; lessons: LessonOption[] };

/**
 * Lessons a learner may combine, split like Home: shared lessons in release
 * order, then their own decks. Callers pass already-visible decks only.
 */
export function lessonSections(
  decks: readonly Deck[],
  cardCounts: ReadonlyMap<string, number>,
  kicker: (deck: Deck) => string | undefined = () => undefined
): LessonSection[] {
  const grouped = decks.some((deck) => deck.source === "global" || deck.source === "private");
  // Like Home, legacy single-user decks carry no Shared/Private label.
  const label = (deck: Deck) => (grouped ? kicker(deck) : undefined);
  const option = (deck: Deck): LessonOption => ({
    id: deck.id,
    name: deck.name,
    cards: cardCounts.get(deck.id) ?? 0,
    ...(label(deck) ? { kicker: label(deck) } : {}),
  });
  if (!grouped) return [{ title: "Lessons", lessons: [...decks].sort(compareLessons).map(option) }];
  return [
    { title: "Shared lessons", lessons: decks.filter((d) => d.source !== "private").sort(compareLessons).map(option) },
    { title: "Your decks", lessons: decks.filter((d) => d.source === "private").sort(compareLessons).map(option) },
  ];
}
