import { applyRating, forgettingCurveDecay, Rating, State } from "./fsrs";
import { localDateKey } from "./forecast";
import type { ReviewMode, StoredFsrs } from "./types";

/**
 * Exam-prep timing for practice groups. Everything here is computed on the
 * fly from the stored FSRS state; nothing is written back. The normal FSRS
 * schedule (95% retention) keeps running underneath, and the exam plan can only
 * bring a review earlier, never push it later.
 */

export const DEFAULT_TARGET_RECALL = 0.95;
export const MIN_TARGET_RECALL = 0.85;
export const MAX_TARGET_RECALL = 0.98;
/** On the day before the exam and exam day, anything predicted below this is reviewed. */
export const FINAL_PASS_RECALL = 0.97;
/** Exam dates are calendar days; recall is predicted for 9am local time that day. */
export const EXAM_HOUR = 9;
/** Only these skills count toward exam readiness. Pinyin is optional practice. */
export const EXAM_MODES = ["review", "write"] as const satisfies readonly ReviewMode[];
export type ExamMode = (typeof EXAM_MODES)[number];

const DAY_MS = 86_400_000;

/** A real YYYY-MM-DD calendar date. */
export function isValidDateKey(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Whole calendar days from one YYYY-MM-DD to another. */
export function dayDiff(fromKey: string, toKey: string): number {
  return Math.round((Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / DAY_MS);
}

function offsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const local = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return local - Math.floor(at.getTime() / 1000) * 1000;
}

/** The instant that is `hour`:00 on `dateKey` in `timeZone`. */
export function zonedTime(dateKey: string, hour: number, timeZone: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  const wall = Date.UTC(y, m - 1, d, hour);
  let guess = wall;
  for (let i = 0; i < 2; i++) guess = wall - offsetMs(new Date(guess), timeZone);
  return new Date(guess);
}

export type ExamClock = {
  now: Date;
  /** Today's local date. */
  today: string;
  examDate: string;
  /** When recall is predicted: 9am local on the exam date, or now if that has passed. */
  examAt: Date;
  /** Calendar days until the exam: 0 on exam day. */
  daysLeft: number;
};

/** Null once the exam date has passed (or with no date): plain FSRS applies again. */
export function examClock(examDate: string | undefined, now: Date, timeZone: string): ExamClock | null {
  if (!examDate || !isValidDateKey(examDate)) return null;
  const today = localDateKey(now, timeZone);
  const daysLeft = dayDiff(today, examDate);
  if (daysLeft < 0) return null;
  const at = zonedTime(examDate, EXAM_HOUR, timeZone);
  return { now, today, examDate, daysLeft, examAt: at.getTime() > now.getTime() ? at : now };
}

/** True on the day before the exam and on exam day. */
export function isFinalPass(clock: ExamClock): boolean {
  return clock.daysLeft <= 1;
}

/** FSRS-6: R(t,S) = (1 + F·t/S)^(-d), with F = 0.9^(-1/d) - 1 so that R(S,S) = 0.9. */
export function forgettingCurve(elapsedDays: number, stability: number, decay: number): number {
  const factor = Math.pow(0.9, -1 / decay) - 1;
  return Math.pow(1 + (factor * Math.max(0, elapsedDays)) / stability, -decay);
}

function hasMemory(stored: StoredFsrs): boolean {
  return stored.state !== State.New && stored.stability > 0 && !!stored.last_review &&
    Number.isFinite(Date.parse(stored.last_review));
}

/** Predicted recall at `at`, or null for a card that has never been reviewed. */
export function recallAt(stored: StoredFsrs, at: Date, decay = forgettingCurveDecay()): number | null {
  if (!hasMemory(stored)) return null;
  const elapsed = (at.getTime() - Date.parse(stored.last_review!)) / DAY_MS;
  return forgettingCurve(elapsed, stored.stability, decay);
}

/**
 * The latest day (offset from today, 0 = today) on which a Good review would
 * still leave recall at the exam at or above `target`. -1 means no day works,
 * so review now. Null means the simulation is unavailable for this state.
 */
export function latestSafeReviewDay(
  stored: StoredFsrs,
  mode: ReviewMode,
  clock: ExamClock,
  target: number,
  decay = forgettingCurveDecay(mode)
): number | null {
  if (!hasMemory(stored)) return null;
  try {
    const examMs = clock.examAt.getTime();
    for (let day = clock.daysLeft; day >= 0; day--) {
      const at = clock.now.getTime() + day * DAY_MS;
      if (at >= examMs) continue;
      const { fsrs } = applyRating(stored, Rating.Good, new Date(at), mode);
      if (!(fsrs.stability > 0)) return null;
      if (forgettingCurve((examMs - at) / DAY_MS, fsrs.stability, decay) >= target) return day;
    }
    return -1;
  } catch {
    return null;
  }
}

export type ExamCardStatus = {
  isNew: boolean;
  /** Predicted recall at the exam without another review. */
  recallAtExam: number | null;
  ready: boolean;
  /** Normal FSRS says it is due now. */
  fsrsDue: boolean;
  /** The exam plan wants it today (latest safe day reached, fallback cap, or final pass). */
  examDue: boolean;
  reviewedToday: boolean;
};

/**
 * Exam status for one card in one skill.
 *
 * A reviewed card is exam-due today when its recall at the exam would fall
 * below the target and the latest safe day to review it has arrived (or no
 * safe day exists). If the simulation is unavailable, it is due once half the
 * remaining time until the exam has passed since the last review. In the final
 * pass, anything predicted below 97% is due. A card already reviewed today is
 * not pulled in again by the exam plan; its own learning steps still apply.
 */
export function examCardStatus(
  stored: StoredFsrs,
  mode: ReviewMode,
  clock: ExamClock,
  target: number,
  timeZone: string,
  decay = forgettingCurveDecay(mode)
): ExamCardStatus {
  const nowMs = clock.now.getTime();
  const dueMs = Date.parse(stored.due);
  const fsrsDue = !Number.isFinite(dueMs) || dueMs <= nowMs;
  if (!hasMemory(stored)) {
    return { isNew: stored.state === State.New, recallAtExam: null, ready: false, fsrsDue, examDue: false, reviewedToday: false };
  }
  const recallAtExam = recallAt(stored, clock.examAt, decay)!;
  const ready = recallAtExam >= target;
  const lastMs = Date.parse(stored.last_review!);
  const reviewedToday = localDateKey(new Date(lastMs), timeZone) === clock.today;
  let examDue = false;
  if (!reviewedToday) {
    if (isFinalPass(clock) && recallAtExam < FINAL_PASS_RECALL) examDue = true;
    else if (!ready) {
      const safeDay = latestSafeReviewDay(stored, mode, clock, target, decay);
      examDue = safeDay === null
        ? nowMs - lastMs >= (clock.examAt.getTime() - nowMs) / 2
        : safeDay <= 0;
    }
  }
  return { isNew: false, recallAtExam, ready, fsrsDue, examDue, reviewedToday };
}

/** New cards per day: ceil(unseen / max(1, daysLeft - buffer)), buffer 1 day within a week of the exam, else 2. */
export function newCardsPerDay(unseen: number, daysLeft: number): number {
  if (unseen <= 0) return 0;
  const buffer = daysLeft <= 7 ? 1 : 2;
  return Math.ceil(unseen / Math.max(1, daysLeft - buffer));
}

/**
 * Today's remaining new-card allowance. The quota is fixed for the day from
 * the count at the start of the day, so learning some cards and reopening the
 * session does not hand out a fresh quota.
 */
export function newQuotaToday(unseenNow: number, introducedToday: number, daysLeft: number): number {
  const quota = newCardsPerDay(unseenNow + introducedToday, daysLeft);
  return Math.max(0, Math.min(unseenNow, quota - introducedToday));
}

/** Parses a target recall, rounding to a whole percent. Null when out of range. */
export function parseTargetRecall(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.round(value * 100) / 100;
  return rounded >= MIN_TARGET_RECALL && rounded <= MAX_TARGET_RECALL ? rounded : null;
}
