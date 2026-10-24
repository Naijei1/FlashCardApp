import { localDateKey } from "./forecast";
import {
  LEGACY_OWNER_EMAIL,
  LEGACY_OWNER_USER_ID,
  claimKey,
  globalCardKey,
  globalDeckKey,
  isStudied,
  progressKey,
  studyStreak,
  userDirectoryKey,
  userProfileKey,
  userStatsKey,
  type ProgressRecord,
} from "./multi-user-model";

export type MigrationItem = Record<string, unknown>;

export type MigrationReport = {
  dryRun: boolean;
  ownerUserId: string;
  ownerEmail: string;
  deletes: 0;
  before: {
    decks: number;
    cards: number;
    cardsWithProgress: number;
    hardMarkers: number;
    reviewLogs: number;
  };
  after: {
    globalDecks: number;
    globalCards: number;
    progressItems: number;
    cardsStudied: number;
    reviewCount: number;
    currentStreak: number;
  };
  puts: number;
  alreadyPresent: number;
  skippedDeletingDecks: number;
  featureFlag: string;
  backupReminder: string;
};

export type MigrationPlan = {
  puts: MigrationItem[];
  report: MigrationReport;
};

export const BACKUP_REMINDER =
  "Back up the DynamoDB table (on-demand backup or export) before --apply. This tool only adds items; it never deletes or overwrites existing ones. Roll reads back with DATA_MODE=legacy.";

export const FEATURE_FLAG_NOTE =
  "DATA_MODE=multi-user reads PROGRESS# items. DATA_MODE=legacy, or unsetting DATA_MODE, restores reads of the original card items. Migrated rows stay in place either way.";

export function assertMigrationTarget(env: {
  tableName?: string;
  endpoint?: string;
  allowRemote?: boolean;
  /** Set only when MIGRATION_ALLOW_PRODUCTION=1. Does not unlock other table names. */
  allowProduction?: boolean;
  apply?: boolean;
  backedUp?: boolean;
}): { ok: true } | { ok: false; reason: string } {
  if (!env.tableName) return { ok: false, reason: "TABLE_NAME is not set" };
  if (env.tableName === "flashcards") {
    if (!env.allowProduction) {
      return {
        ok: false,
        reason:
          "Refusing table flashcards. Set MIGRATION_ALLOW_PRODUCTION=1 to confirm this is production. A dry run is allowed with that flag. Writing also requires --apply --i-backed-up. MIGRATION_ALLOW_REMOTE=1 does not unlock this table.",
      };
    }
    if (env.apply && !env.backedUp) {
      return {
        ok: false,
        reason:
          "Refusing to write table flashcards without --apply --i-backed-up, even when MIGRATION_ALLOW_PRODUCTION=1.",
      };
    }
    return { ok: true };
  }
  if (!env.endpoint && !env.allowRemote) {
    return {
      ok: false,
      reason: "Refusing a real AWS endpoint. Set DYNAMODB_ENDPOINT for a local or copied table, or MIGRATION_ALLOW_REMOTE=1 for a non-production table.",
    };
  }
  return { ok: true };
}

function keyOf(item: MigrationItem): string {
  return `${String(item.PK)}\u0000${String(item.SK)}`;
}

function text(item: MigrationItem, field: string): string | undefined {
  const value = item[field];
  return typeof value === "string" ? value : undefined;
}

export function planMigration(
  items: readonly MigrationItem[],
  options: {
    ownerEmail?: string;
    ownerUserId?: string;
    now: string;
    timeZone: string;
    dryRun?: boolean;
  }
): MigrationPlan {
  const ownerEmail = (options.ownerEmail || LEGACY_OWNER_EMAIL).trim().toLowerCase();
  const ownerUserId = options.ownerUserId || LEGACY_OWNER_USER_ID;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) {
    throw new Error("LEGACY_OWNER_EMAIL is not a valid email");
  }
  if (ownerUserId.includes("@") || ownerUserId.includes("#")) {
    throw new Error("Legacy owner id must be a stable app id, not an email");
  }

  const present = new Set(items.map(keyOf));
  const deletingDecks = new Set<string>();
  const decks: MigrationItem[] = [];
  for (const item of items) {
    if (item.PK !== "DECKS" || typeof item.SK !== "string" || !item.SK.startsWith("DECK#")) continue;
    const id = item.SK.slice("DECK#".length);
    if (typeof item.deletingAt === "string") {
      deletingDecks.add(id);
      continue;
    }
    decks.push(item);
  }

  const cards: MigrationItem[] = [];
  for (const item of items) {
    if (typeof item.PK !== "string" || typeof item.SK !== "string") continue;
    if (!/^DECK#[^#]+$/.test(item.PK) || !item.SK.startsWith("CARD#")) continue;
    const deckId = item.PK.slice("DECK#".length);
    if (deletingDecks.has(deckId)) continue;
    cards.push(item);
  }

  const deckIds = new Set(decks.map((deck) => String(deck.SK).slice("DECK#".length)));
  for (const card of cards) deckIds.add(String(card.PK).slice("DECK#".length));

  const reviewInstants: string[] = [];
  for (const item of items) {
    if (item.PK !== "LOGS") continue;
    const instant = text(item, "reviewedAt") ?? (typeof item.SK === "string" ? item.SK.split("#")[0] : "");
    if (Number.isFinite(Date.parse(instant))) reviewInstants.push(instant);
  }
  const statsItem = items.find((item) => item.PK === "META" && item.SK === "STATS");
  const reviewCount =
    typeof statsItem?.reviewCount === "number" ? statsItem.reviewCount : reviewInstants.length;
  const today = localDateKey(new Date(options.now), options.timeZone);
  const streak = studyStreak(
    reviewInstants.map((instant) => localDateKey(new Date(instant), options.timeZone)),
    today
  );

  const puts: MigrationItem[] = [];
  const queue = (item: MigrationItem) => {
    if (present.has(keyOf(item))) return;
    puts.push(item);
    present.add(keyOf(item));
  };

  let hardMarkers = 0;
  let cardsWithProgress = 0;
  let cardsStudied = 0;
  for (const deckId of deckIds) {
    const source = decks.find((deck) => String(deck.SK).slice("DECK#".length) === deckId);
    const createdAt = text(source ?? {}, "createdAt") ?? options.now;
    queue({
      ...globalDeckKey(deckId),
      name: text(source ?? {}, "name") ?? deckId,
      createdAt,
      updatedAt: text(source ?? {}, "updatedAt") ?? createdAt,
      source: "global",
      status: "published",
      releaseAt: createdAt,
      ...(text(source ?? {}, "frontLanguage") ? { frontLanguage: text(source ?? {}, "frontLanguage") } : {}),
      ...(text(source ?? {}, "backLanguage") ? { backLanguage: text(source ?? {}, "backLanguage") } : {}),
      ...(source?.chineseSide === "front" || source?.chineseSide === "back"
        ? { chineseSide: source.chineseSide }
        : {}),
    });
  }

  for (const card of cards) {
    const deckId = String(card.PK).slice("DECK#".length);
    const cardId = String(card.SK).slice("CARD#".length);
    const createdAt = text(card, "createdAt") ?? options.now;
    if (card.fsrs && typeof card.fsrs === "object") cardsWithProgress += 1;
    if (card.hard === true) hardMarkers += 1;
    const progress = {
      ...(card.fsrs && typeof card.fsrs === "object" ? { fsrs: card.fsrs as ProgressRecord["fsrs"] } : {}),
      ...(card.modes && typeof card.modes === "object" ? { modes: card.modes as ProgressRecord["modes"] } : {}),
      ...(card.practice && typeof card.practice === "object"
        ? { practice: card.practice as ProgressRecord["practice"] }
        : {}),
      ...(card.hard === true ? { hard: true as const } : {}),
    };
    if (isStudied(progress)) cardsStudied += 1;
    queue({
      ...globalCardKey(deckId, cardId),
      front: text(card, "front") ?? "",
      back: text(card, "back") ?? "",
      createdAt,
      updatedAt: text(card, "updatedAt") ?? createdAt,
      contentVersion: 1,
      source: "global",
      ...(text(card, "notes") ? { notes: text(card, "notes") } : {}),
    });
    queue({
      ...progressKey(ownerUserId, "global", deckId, cardId),
      source: "global",
      deckId,
      cardId,
      ...(card.fsrs && typeof card.fsrs === "object" ? { fsrs: card.fsrs } : {}),
      ...(card.modes && typeof card.modes === "object" ? { modes: card.modes } : {}),
      ...(card.practice && typeof card.practice === "object" ? { practice: card.practice } : {}),
      ...(card.hard === true ? { hard: true } : {}),
      ...(typeof card.reviewVersion === "number" ? { reviewVersion: card.reviewVersion } : {}),
      updatedAt: text(card, "updatedAt") ?? createdAt,
    });
  }

  const existingClaims = items.filter(
    (item) =>
      typeof item.PK === "string" &&
      item.PK.startsWith("CLAIM#email#") &&
      item.SK === "USER" &&
      item.userId === ownerUserId &&
      typeof item.claimedSub === "string" &&
      item.claimedSub.length > 0
  );
  queue({
    ...userProfileKey(ownerUserId),
    userId: ownerUserId,
    email: ownerEmail,
    role: "user",
    status: existingClaims.length > 0 ? "active" : "pending-claim",
    createdAt: options.now,
    authProvider: "google",
  });
  queue({
    ...userDirectoryKey(ownerUserId),
    userId: ownerUserId,
    email: ownerEmail,
    role: "user",
    status: existingClaims.length > 0 ? "active" : "pending-claim",
    createdAt: options.now,
    cardsStudied,
    reviewCount,
    currentStreak: streak.currentStreak,
    ...(streak.lastStudiedOn ? { lastStudiedOn: streak.lastStudiedOn } : {}),
    ...(reviewInstants.length > 0
      ? { lastReviewAt: reviewInstants.slice().sort().at(-1) }
      : {}),
  });
  queue({
    ...userStatsKey(ownerUserId),
    reviewCount,
    cardsStudied,
    currentStreak: streak.currentStreak,
    ...(streak.lastStudiedOn ? { lastStudiedOn: streak.lastStudiedOn } : {}),
    ...(reviewInstants.length > 0
      ? { lastReviewAt: reviewInstants.slice().sort().at(-1) }
      : {}),
    updatedAt: options.now,
  });
  if (existingClaims.length === 0) {
    queue({
      ...claimKey(ownerEmail),
      userId: ownerUserId,
      email: ownerEmail,
      createdAt: options.now,
    });
  }

  const afterKeys = [...present];
  const countKeys = (match: (pk: string, sk: string) => boolean) =>
    afterKeys.filter((key) => {
      const [itemPk, itemSk] = key.split("\u0000");
      return match(itemPk, itemSk);
    }).length;

  const plannedTargets =
    deckIds.size + cards.length * 2 + 3 + (existingClaims.length === 0 ? 1 : 0);

  const report: MigrationReport = {
    dryRun: options.dryRun !== false,
    ownerUserId,
    ownerEmail,
    deletes: 0,
    before: {
      decks: decks.length,
      cards: cards.length,
      cardsWithProgress,
      hardMarkers,
      reviewLogs: reviewInstants.length,
    },
    after: {
      globalDecks: countKeys((pk, sk) => pk === "GLOBAL#DECKS" && sk.startsWith("DECK#")),
      globalCards: countKeys((pk, sk) => pk.startsWith("GLOBAL#DECK#") && sk.startsWith("CARD#")),
      progressItems: countKeys(
        (pk, sk) => pk === `USER#${ownerUserId}` && sk.startsWith("PROGRESS#")
      ),
      cardsStudied,
      reviewCount,
      currentStreak: streak.currentStreak,
    },
    puts: puts.length,
    alreadyPresent: plannedTargets - puts.length,
    skippedDeletingDecks: deletingDecks.size,
    featureFlag: FEATURE_FLAG_NOTE,
    backupReminder: BACKUP_REMINDER,
  };

  return { puts, report };
}
