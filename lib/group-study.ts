// Server-only by import convention: this pulls in the pinyin dictionary.
import { mergeCramEntries, type CramEntry } from "./cram";
import { isLearning, isNew, SESSION_LIMIT, shuffle } from "./due";
import {
  EXAM_MODES,
  examCardStatus,
  examClock,
  newQuotaToday,
  type ExamClock,
  type ExamCardStatus,
} from "./exam";
import { localDateKey } from "./forecast";
import { forgettingCurveDecay } from "./fsrs";
import { cardForMode } from "./modes";
import { studyDetails } from "./pinyin-queue";
import { DAILY_WORD_GOAL } from "./practice";
import { groupTargetRecall, type GroupPlan, type PracticeGroup } from "./practice-groups";
import type { StudyQueueItem } from "./review-queue";
import type { Card, Deck, ReviewMode } from "./types";
import { chineseSideForDeck, type ChineseSide } from "./write";

export type { GroupPlan };

export type CardRef = { deckId: string; id: string };

export type GroupStudyItem = StudyQueueItem & { copies: CardRef[] };

export type GroupContext = {
  group: Pick<PracticeGroup, "examDate" | "targetRecall">;
  decks: readonly Deck[];
  now: Date;
  timeZone: string;
};

type ModeItem = {
  entry: CramEntry;
  /** Representative copy, projected to the mode, carrying the freshest copy's memory. */
  card: Card;
  details: Omit<StudyQueueItem, "card">;
  status?: ExamCardStatus;
};

const NEW_SLOTS_PER_BATCH = 11;

function lastReviewMs(card: Card): number {
  return Date.parse(card.fsrs.last_review ?? "") || 0;
}

/**
 * The representative card for one skill. Copies are rated together, so they
 * normally agree; when they do not (one was studied in its own lesson), the
 * most recently reviewed copy's memory is the best estimate for the word.
 */
function projectEntry(entry: CramEntry, mode: ReviewMode): Card {
  const shown = cardForMode(entry.card, mode);
  let best = shown;
  for (const copy of entry.copies.slice(1)) {
    const projected = cardForMode(copy, mode);
    if (lastReviewMs(projected) > lastReviewMs(best) ||
      (lastReviewMs(projected) === lastReviewMs(best) && projected.fsrs.reps > best.fsrs.reps)) best = projected;
  }
  return best === shown ? shown : { ...shown, fsrs: best.fsrs, practice: best.practice };
}

function introducedOn(card: Card, today: string, timeZone: string): boolean {
  const at = card.practice?.skillStartedAt ?? card.practice?.firstStudiedAt;
  return !!at && Number.isFinite(Date.parse(at)) && localDateKey(new Date(at), timeZone) === today;
}

export function groupEntries(cards: readonly Card[], decks: readonly Deck[]): CramEntry[] {
  return mergeCramEntries(cards, decks);
}

function sideLookup(decks: readonly Deck[]): (card: Card) => ChineseSide | null {
  const sides = new Map(decks.map((deck) => [deck.id, chineseSideForDeck(deck)]));
  return (card) => sides.get(card.deckId) ?? null;
}

/** Cards this skill can practice, projected with their merged memory. */
function modeItems(entries: readonly CramEntry[], mode: ReviewMode, ctx: GroupContext, clock: ExamClock | null): ModeItem[] {
  const sideFor = sideLookup(ctx.decks);
  const target = groupTargetRecall(ctx.group);
  const decay = forgettingCurveDecay(mode);
  const items: ModeItem[] = [];
  for (const entry of entries) {
    const card = projectEntry(entry, mode);
    const base = studyDetails(card, mode, sideFor(card));
    if (!base) continue;
    // Keep the reading chosen for the merged word, including hints from the meaning side or notes.
    const syllables = entry.view.pinyin?.split(" ").filter(Boolean);
    const details = base.pinyin && syllables?.length === base.pinyin.syllables.length
      ? { ...base, pinyin: { ...base.pinyin, syllables } }
      : base;
    const status = clock ? examCardStatus(card.fsrs, mode, clock, target, ctx.timeZone, decay) : undefined;
    items.push({ entry, card, details, status });
  }
  return items;
}

/** Whether the exam plan applies to this skill right now. Pinyin never counts. */
function clockFor(mode: ReviewMode, ctx: GroupContext): ExamClock | null {
  if (!(EXAM_MODES as readonly ReviewMode[]).includes(mode)) return null;
  return examClock(ctx.group.examDate, ctx.now, ctx.timeZone);
}

function isUnseen(item: ModeItem): boolean {
  return isNew(item.card);
}

function isDueNow(item: ModeItem, now: Date): boolean {
  const due = Date.parse(item.card.fsrs.due);
  return !Number.isFinite(due) || due <= now.getTime();
}

type ModePlan = {
  reviews: ModeItem[];
  unseen: ModeItem[];
  /** New cards allowed today (before "learn more"). */
  newToday: number;
  ready: number;
  total: number;
};

function planMode(entries: readonly CramEntry[], mode: ReviewMode, ctx: GroupContext): ModePlan {
  const clock = clockFor(mode, ctx);
  const items = modeItems(entries, mode, ctx, clock);
  const today = localDateKey(ctx.now, ctx.timeZone);
  const unseen = items.filter(isUnseen)
    .sort((a, b) => a.card.createdAt.localeCompare(b.card.createdAt) || a.card.id.localeCompare(b.card.id));
  const reviews = items.filter((item) => !isUnseen(item) && (isDueNow(item, ctx.now) || item.status?.examDue));
  const introduced = items.filter((item) => introducedOn(item.card, today, ctx.timeZone)).length;
  const newToday = clock
    ? newQuotaToday(unseen.length, introduced, clock.daysLeft)
    : Math.min(unseen.length, Math.max(0, DAILY_WORD_GOAL - introduced));
  // Lowest predicted exam recall first, then the most overdue.
  reviews.sort((a, b) =>
    Number(isLearning(b.card)) - Number(isLearning(a.card)) ||
    (a.status?.recallAtExam ?? 0) - (b.status?.recallAtExam ?? 0) ||
    Date.parse(a.card.fsrs.due) - Date.parse(b.card.fsrs.due));
  return {
    reviews,
    unseen,
    newToday,
    ready: items.filter((item) => item.status?.ready).length,
    total: items.length,
  };
}

function toQueueItem(item: ModeItem, now: Date, forceReady: boolean): GroupStudyItem {
  const due = Date.parse(item.card.fsrs.due);
  const early = !Number.isFinite(due) || due > now.getTime();
  return {
    card: item.card,
    ...item.details,
    copies: item.entry.copies.map((copy) => ({ deckId: copy.deckId, id: copy.id })),
    ...(forceReady && early ? { readyAt: now.toISOString() } : {}),
  };
}

export type GroupQueue = { queue: GroupStudyItem[]; totalDue: number; remainingNew: number };

/**
 * One batch for a group session in one skill. "today" mixes reviews that are
 * due (by FSRS or by the exam plan) with today's new cards, in batches like
 * normal study. "all" is extra practice: every card once, shuffled, still saved.
 */
export function buildGroupQueue(
  entries: readonly CramEntry[],
  options: GroupContext & { mode: ReviewMode; plan: GroupPlan; extendNew?: boolean; random?: () => number }
): GroupQueue {
  const { mode, plan, now, random = Math.random } = options;
  if (plan === "all") {
    const items = modeItems(entries, mode, options, null);
    return { queue: shuffle(items, random).map((item) => toQueueItem(item, now, true)), totalDue: items.length, remainingNew: 0 };
  }
  const { reviews, unseen, newToday } = planMode(entries, mode, options);
  const allowance = options.extendNew ? Math.min(unseen.length, newToday + DAILY_WORD_GOAL) : newToday;
  const allowed = unseen.slice(0, allowance);
  const newSlots = Math.min(NEW_SLOTS_PER_BATCH, allowed.length, SESSION_LIMIT);
  const selectedReviews = reviews.slice(0, SESSION_LIMIT - newSlots);
  const selectedNew = allowed.slice(0, SESSION_LIMIT - selectedReviews.length);
  const learning = shuffle(selectedReviews.filter((item) => isLearning(item.card)), random);
  const rest = shuffle(selectedReviews.filter((item) => !isLearning(item.card)), random);
  return {
    queue: [...learning, ...rest, ...shuffle(selectedNew, random)].map((item) => toQueueItem(item, now, true)),
    totalDue: reviews.length + allowed.length,
    remainingNew: unseen.length - allowed.length,
  };
}

export type ModeSummary = { due: number; newToday: number; ready: number; total: number; unseen: number };

export type GroupSummary = {
  /** Present only while the exam is today or ahead. */
  exam?: {
    examDate: string;
    daysLeft: number;
    targetRecall: number;
    finalPass: boolean;
    ready: number;
    total: number;
    due: number;
    newToday: number;
  };
  modes: Record<ReviewMode, ModeSummary>;
};

/** Counts for Home and the group page. Recognition + writing make up the exam plan. */
export function summarizeGroup(entries: readonly CramEntry[], ctx: GroupContext): GroupSummary {
  const modes = {} as Record<ReviewMode, ModeSummary>;
  for (const mode of ["review", "write", "pinyin"] as const) {
    const plan = planMode(entries, mode, ctx);
    modes[mode] = { due: plan.reviews.length, newToday: plan.newToday, ready: plan.ready, total: plan.total, unseen: plan.unseen.length };
  }
  const clock = examClock(ctx.group.examDate, ctx.now, ctx.timeZone);
  if (!clock) return { modes };
  const sum = (field: keyof ModeSummary) => EXAM_MODES.reduce((total, mode) => total + modes[mode][field], 0);
  return {
    modes,
    exam: {
      examDate: clock.examDate,
      daysLeft: clock.daysLeft,
      targetRecall: groupTargetRecall(ctx.group),
      finalPass: clock.daysLeft <= 1,
      ready: sum("ready"),
      total: sum("total"),
      due: sum("due"),
      newToday: sum("newToday"),
    },
  };
}

/** "Final in N days · X/Y ready · today: a due + b new". */
export function examTileLine(exam: NonNullable<GroupSummary["exam"]>): string {
  const when = exam.daysLeft === 0 ? "Final today" : `Final in ${exam.daysLeft} ${exam.daysLeft === 1 ? "day" : "days"}`;
  return `${when} · ${exam.ready}/${exam.total} ready · today: ${exam.due} due + ${exam.newToday} new`;
}
