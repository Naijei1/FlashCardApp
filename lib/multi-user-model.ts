import { emptyCardState, currentRetentionSchedule } from "./fsrs";
import type { Role } from "./principal";
import type { Card, CardSource, Deck, StoredFsrs } from "./types";

/**
 * Opaque id for the pre-multi-user study history. It is not an email and it
 * does not encode the admin address. Progress is claimed by LEGACY_OWNER_EMAIL.
 */
export const LEGACY_OWNER_USER_ID = "user_legacy_owner";
/** Verified Gmail that should claim the migrated study progress. Not an admin. */
export const LEGACY_OWNER_EMAIL = "naijeiwow@gmail.com";

export type { CardSource };

export type ContentRecord = {
  deckId: string;
  cardId: string;
  front: string;
  back: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  contentVersion?: number;
  archivedAt?: string;
  source: CardSource;
};

export type ProgressRecord = {
  fsrs?: StoredFsrs;
  modes?: Card["modes"];
  practice?: Card["practice"];
  hard?: boolean;
  reviewVersion?: number;
  updatedAt?: string;
};

export type AdminUserSummary = {
  userId: string;
  email: string;
  role: Role;
  cardsStudied: number;
  reviewCount: number;
  currentStreak: number;
  lastReviewAt?: string;
};

const ADMIN_SUMMARY_KEYS = [
  "userId",
  "email",
  "role",
  "cardsStudied",
  "reviewCount",
  "currentStreak",
  "lastReviewAt",
] as const;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  const normalized = normalizeEmail(email);
  return normalized.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
}

/** Google `sub` is the account key. It is never an email address. */
export function isValidGoogleSub(sub: string): boolean {
  return sub.length > 0 && sub.length <= 256 && !/[#\s/]/.test(sub) && !sub.includes("@");
}

export function adminAllowlist(raw = process.env.ADMIN_EMAILS ?? ""): Set<string> {
  return new Set(
    raw
      .split(",")
      .map((email) => normalizeEmail(email))
      .filter((email) => email.length > 0)
  );
}

/**
 * Admin is granted only when Google says the email is verified AND it is on
 * the allowlist. An unverified address is never an admin, even if listed.
 */
export function roleForVerifiedEmail(email: string, emailVerified: boolean): Role {
  if (!emailVerified) return "user";
  return adminAllowlist().has(normalizeEmail(email)) ? "admin" : "user";
}

export function googleAuthKey(sub: string): { PK: string; SK: string } {
  return { PK: `AUTH#google#${sub}`, SK: "LINK" };
}

export function claimKey(email: string): { PK: string; SK: string } {
  return { PK: `CLAIM#email#${normalizeEmail(email)}`, SK: "USER" };
}

export function userProfileKey(userId: string): { PK: string; SK: string } {
  return { PK: `USER#${userId}`, SK: "PROFILE" };
}

export function userDirectoryKey(userId: string): { PK: string; SK: string } {
  return { PK: "USERS", SK: `USER#${userId}` };
}

export function globalDeckKey(deckId: string): { PK: string; SK: string } {
  return { PK: "GLOBAL#DECKS", SK: `DECK#${deckId}` };
}

export function globalCardKey(deckId: string, cardId: string): { PK: string; SK: string } {
  return { PK: `GLOBAL#DECK#${deckId}`, SK: `CARD#${cardId}` };
}

export function privateDecksKey(userId: string): { PK: string } {
  return { PK: `USER#${userId}#DECKS` };
}

export function privateDeckKey(userId: string, deckId: string): { PK: string; SK: string } {
  return { PK: `USER#${userId}#DECKS`, SK: `DECK#${deckId}` };
}

export function privateCardKey(userId: string, deckId: string, cardId: string): { PK: string; SK: string } {
  return { PK: `USER#${userId}#DECK#${deckId}`, SK: `CARD#${cardId}` };
}

export function progressKey(
  userId: string,
  source: CardSource,
  deckId: string,
  cardId: string
): { PK: string; SK: string } {
  const scope = source === "global" ? "GLOBAL" : "PRIVATE";
  return { PK: `USER#${userId}`, SK: `PROGRESS#${scope}#${deckId}#CARD#${cardId}` };
}

export function progressPrefix(userId: string, source: CardSource, deckId: string): { PK: string; SK: string } {
  const scope = source === "global" ? "GLOBAL" : "PRIVATE";
  return { PK: `USER#${userId}`, SK: `PROGRESS#${scope}#${deckId}#CARD#` };
}

export function hiddenCardKey(userId: string, deckId: string, cardId: string): { PK: string; SK: string } {
  return { PK: `USER#${userId}`, SK: `HIDDEN#GLOBAL#${deckId}#CARD#${cardId}` };
}

export function hiddenPrefix(userId: string, deckId: string): { PK: string; SK: string } {
  return { PK: `USER#${userId}`, SK: `HIDDEN#GLOBAL#${deckId}#CARD#` };
}

export function userStatsKey(userId: string): { PK: string; SK: string } {
  return { PK: `USER#${userId}#META`, SK: "STATS" };
}

export function userLogsKey(userId: string): string {
  return `USER#${userId}#LOGS`;
}

export function userReceiptsKey(userId: string): string {
  return `USER#${userId}#REVIEW_REQUESTS`;
}

export function releaseWeekLabel(week: number): string {
  return `week ${week}`;
}

export function isReleasedToLearners(
  deck: { status?: string | null; releaseAt?: string | null; archivedAt?: string | null; source?: string | null },
  now: Date
): boolean {
  if (deck.archivedAt) return false;
  if (deck.source === "private") return true;
  if (!deck.status || deck.status === "published") return true;
  if (deck.status === "scheduled") {
    const at = deck.releaseAt ? Date.parse(deck.releaseAt) : Number.NaN;
    return Number.isFinite(at) && at <= now.getTime();
  }
  return false;
}

export function effectiveCard(input: {
  content: ContentRecord;
  progress: ProgressRecord | null;
  hidden: boolean;
  released: boolean;
  /** Admin previews show content only. Learner progress is not applied. */
  hideProgress: boolean;
}): Card | null {
  if (input.content.archivedAt || !input.released) return null;
  if (input.hidden && !input.hideProgress) return null;
  const progress = input.hideProgress ? null : input.progress;
  const createdAt = input.content.createdAt;
  const fsrs = currentRetentionSchedule(
    progress?.fsrs ?? emptyCardState(new Date(createdAt))
  );
  const card: Card = {
    id: input.content.cardId,
    deckId: input.content.deckId,
    front: input.content.front,
    back: input.content.back,
    createdAt,
    updatedAt: progress?.updatedAt ?? input.content.updatedAt,
    fsrs,
    source: input.content.source,
    ...(input.content.notes ? { notes: input.content.notes } : {}),
    ...(typeof input.content.contentVersion === "number"
      ? { contentVersion: input.content.contentVersion }
      : {}),
    ...(progress?.modes ? { modes: progress.modes } : {}),
    ...(progress?.practice ? { practice: progress.practice } : {}),
    ...(progress?.hard ? { hard: true } : {}),
  };
  return card;
}

export type AccountPlan =
  | { action: "reject"; reason: "unverified-email" | "invalid-identity" }
  | { action: "existing"; userId: string; role: Role }
  | { action: "claim"; userId: string; role: Role }
  | { action: "create"; role: Role };

/**
 * Identity is `AUTH#google#<sub>`. Email is only a one-time claim for the
 * migrated placeholder, never the lookup key for later sign-ins.
 */
export function planAccountLink(input: {
  sub: string;
  email: string;
  emailVerified: boolean;
  adminAllowlist: readonly string[];
  existingLinkUserId?: string | null;
  claim?: { userId: string; claimedSub?: string | null } | null;
}): AccountPlan {
  if (!input.emailVerified) return { action: "reject", reason: "unverified-email" };
  if (!isValidGoogleSub(input.sub) || !isValidEmail(input.email)) {
    return { action: "reject", reason: "invalid-identity" };
  }
  const allow = new Set(input.adminAllowlist.map((email) => normalizeEmail(email)));
  const role: Role = allow.has(normalizeEmail(input.email)) ? "admin" : "user";
  if (input.existingLinkUserId) {
    return { action: "existing", userId: input.existingLinkUserId, role };
  }
  const claim = input.claim;
  if (claim?.userId && (!claim.claimedSub || claim.claimedSub === input.sub)) {
    return { action: "claim", userId: claim.userId, role };
  }
  return { action: "create", role };
}

export function planGlobalEdit(input: {
  editKind: string;
  cardId: string;
  now: string;
  newId: string;
  contentVersion?: number;
}):
  | { error: string }
  | { kind: "typo"; id: string; contentVersion: number }
  | { kind: "meaning"; archivedId: string; createdId: string; archivedAt: string } {
  if (input.editKind !== "typo" && input.editKind !== "meaning") {
    return { error: "Choose whether this is a typo fix or a meaning change" };
  }
  if (input.editKind === "typo") {
    return { kind: "typo", id: input.cardId, contentVersion: (input.contentVersion ?? 1) + 1 };
  }
  if (input.newId === input.cardId) {
    return { error: "A meaning change needs a new card id" };
  }
  return {
    kind: "meaning",
    archivedId: input.cardId,
    createdId: input.newId,
    archivedAt: input.now,
  };
}

export function previousDay(key: string): string {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
}

export function nextDay(key: string): string {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

export function nextStudyStreak(
  current: number,
  lastStudiedOn: string | undefined,
  studiedOn: string
): { currentStreak: number; lastStudiedOn: string } {
  if (lastStudiedOn === studiedOn) {
    return { currentStreak: Math.max(current, 1), lastStudiedOn: studiedOn };
  }
  if (lastStudiedOn && nextDay(lastStudiedOn) === studiedOn) {
    return { currentStreak: Math.max(current, 1) + 1, lastStudiedOn: studiedOn };
  }
  return { currentStreak: 1, lastStudiedOn: studiedOn };
}

export function studyStreak(
  days: readonly string[],
  today: string
): { currentStreak: number; lastStudiedOn?: string } {
  const set = new Set(days);
  const start = set.has(today) ? today : previousDay(today);
  if (!set.has(start)) return { currentStreak: 0 };
  let cursor = start;
  let count = 0;
  while (set.has(cursor)) {
    count += 1;
    cursor = previousDay(cursor);
  }
  return { currentStreak: count, lastStudiedOn: start };
}

export function isStudied(progress: ProgressRecord | null | undefined): boolean {
  if (!progress) return false;
  if ((progress.fsrs?.reps ?? 0) > 0) return true;
  const practice = progress.practice;
  if ((practice?.failures ?? 0) + (practice?.successes ?? 0) > 0) return true;
  for (const mode of ["write", "pinyin"] as const) {
    const state = progress.modes?.[mode];
    if (!state) continue;
    if ((state.fsrs?.reps ?? 0) > 0) return true;
    const modePractice = state.practice;
    if ((modePractice?.failures ?? 0) + (modePractice?.successes ?? 0) > 0) return true;
  }
  return false;
}

export function toAdminUserSummary(row: Record<string, unknown>): AdminUserSummary {
  const role: Role = row.role === "admin" ? "admin" : "user";
  const summary: AdminUserSummary = {
    userId: typeof row.userId === "string" ? row.userId : "",
    email: typeof row.email === "string" ? row.email : "",
    role,
    cardsStudied: numberField(row.cardsStudied),
    reviewCount: numberField(row.reviewCount),
    currentStreak: numberField(row.currentStreak),
  };
  if (typeof row.lastReviewAt === "string" && row.lastReviewAt) summary.lastReviewAt = row.lastReviewAt;
  return summary;
}

export function adminSummaryKeys(): readonly string[] {
  return ADMIN_SUMMARY_KEYS;
}

function numberField(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function deckFromItem(item: Record<string, unknown>, id: string, source: CardSource): Deck {
  return {
    id,
    name: typeof item.name === "string" ? item.name : "Untitled",
    createdAt: typeof item.createdAt === "string" ? item.createdAt : "",
    updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : "",
    source,
    ...(typeof item.frontLanguage === "string" && item.frontLanguage ? { frontLanguage: item.frontLanguage } : {}),
    ...(typeof item.backLanguage === "string" && item.backLanguage ? { backLanguage: item.backLanguage } : {}),
    ...(item.chineseSide === "front" || item.chineseSide === "back" ? { chineseSide: item.chineseSide } : {}),
    ...(item.status === "draft" || item.status === "scheduled" || item.status === "published"
      ? { status: item.status }
      : {}),
    ...(typeof item.releaseWeek === "number" ? { releaseWeek: item.releaseWeek } : {}),
    ...(typeof item.releaseAt === "string" ? { releaseAt: item.releaseAt } : {}),
    ...(typeof item.archivedAt === "string" ? { archivedAt: item.archivedAt } : {}),
  };
}
