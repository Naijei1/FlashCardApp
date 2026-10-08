import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { totalCounts } from "./due";
import { currentRetentionSchedule } from "./fsrs";
import type { Card, StoredFsrs } from "./types";

type Item = Record<string, unknown>;
type Source = "global" | "private";

export class MigrationError extends Error {
  readonly code: string;
  constructor(message: string, code = "migration_failed") {
    super(message);
    this.name = "MigrationError";
    this.code = code;
  }
}

export type MigrationConfig = {
  naijeiUserId: string;
  adminUserId: string;
  naijeiEmail?: string;
  adminEmail?: string;
  decks: Record<string, Source>;
};

export type MigrationReport = {
  sourceDeckCount: number;
  globalDeckCount: number;
  privateDeckCount: number;
  sourceCardCount: number;
  migratedContentCount: number;
  migratedProgressCount: number;
  reviewLogCount: number;
  reviewReceiptCount: number;
  hardMarkerCount: number;
  dueBefore: number;
  dueAfter: number;
  newBefore: number;
  newAfter: number;
  createdCount: number;
  skippedExisting: number;
  legacyRecordsRetained: number;
};

type LegacySnapshot = {
  decks: Item[];
  cards: Item[];
  logs: Item[];
  receipts: Item[];
  stats: Item | null;
};

const USER_ID = /^[A-Za-z0-9_.:@|-]{1,128}$/;

export function assertSafeMigrationTarget(tableName: string, endpoint?: string): void {
  if (!tableName) throw new MigrationError("TABLE_NAME is required");
  if (tableName === "flashcards" && process.env.MIGRATION_ALLOW_PRODUCTION_TABLE !== "I_UNDERSTAND") {
    throw new MigrationError(
      "Refusing to migrate the production table flashcards. Copy it first and set TABLE_NAME to the copy.",
      "production_table"
    );
  }
  const allowAws = process.env.MIGRATION_ALLOW_AWS === "I_UNDERSTAND";
  if (!endpoint && !allowAws) {
    throw new MigrationError(
      "Refusing to migrate without DYNAMODB_ENDPOINT. Point this tool at DynamoDB Local or an explicit non-production copy.",
      "aws_refused"
    );
  }
  if (endpoint?.includes("amazonaws.com") && !allowAws) {
    throw new MigrationError("Refusing to use an AWS DynamoDB endpoint", "aws_refused");
  }
}

export function validateDeckClassification(
  deckIds: readonly string[],
  decks: Record<string, string>
): void {
  const known = new Set(deckIds);
  const unclassified = deckIds.filter((id) => decks[id] !== "global" && decks[id] !== "private");
  const unknown = Object.keys(decks).filter((id) => !known.has(id));
  if (unclassified.length === 0 && unknown.length === 0) return;
  throw new MigrationError(
    `Every existing deck must be classified as "global" or "private" before migration. Unclassified: ${
      unclassified.join(", ") || "(none)"
    }. Config ids that are not existing decks: ${unknown.join(", ") || "(none)"}.`,
    "unclassified_decks"
  );
}

function assertConfig(config: MigrationConfig): void {
  if (!USER_ID.test(config.naijeiUserId)) {
    throw new MigrationError("naijeiUserId must be a Cognito sub and cannot contain '#'");
  }
  if (!USER_ID.test(config.adminUserId)) {
    throw new MigrationError("adminUserId must be a Cognito sub and cannot contain '#'");
  }
  if (config.naijeiUserId === config.adminUserId) {
    throw new MigrationError("The admin account and Naijei's user account must be different");
  }
  for (const [id, visibility] of Object.entries(config.decks)) {
    if (visibility !== "global" && visibility !== "private") {
      throw new MigrationError(`Deck ${id} has invalid visibility ${String(visibility)}`);
    }
  }
}

function clientFor(endpoint: string | undefined, region: string): DynamoDBDocumentClient {
  const client = new DynamoDBClient({
    region,
    ...(endpoint
      ? { endpoint, credentials: { accessKeyId: "local", secretAccessKey: "local" } }
      : {}),
  });
  return DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true },
  });
}

async function queryPartition(
  client: DynamoDBDocumentClient,
  tableName: string,
  pk: string,
  skPrefix?: string
): Promise<Item[]> {
  const items: Item[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const response = await client.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: skPrefix ? "PK = :pk AND begins_with(SK, :sk)" : "PK = :pk",
        ExpressionAttributeValues: skPrefix ? { ":pk": pk, ":sk": skPrefix } : { ":pk": pk },
        ConsistentRead: true,
        ExclusiveStartKey: startKey,
      })
    );
    items.push(...((response.Items ?? []) as Item[]));
    startKey = response.LastEvaluatedKey;
  } while (startKey);
  return items;
}

function deckIdOf(item: Item): string {
  return String(item.SK).slice("DECK#".length);
}

function cardIdOf(item: Item): string {
  return String(item.SK).slice("CARD#".length);
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalize(entry)])
    );
  }
  return value;
}

function fingerprint(items: Item[]): string {
  return JSON.stringify(
    items
      .map((item) => normalize(item) as Item)
      .sort((left, right) =>
        `${String(left.PK)}|${String(left.SK)}`.localeCompare(`${String(right.PK)}|${String(right.SK)}`)
      )
  );
}

function sameItem(existing: Item | undefined, expected: Item, ignore: string[] = []): boolean {
  if (!existing) return false;
  const skip = new Set(["PK", "SK", ...ignore]);
  const pick = (item: Item) => {
    const copy: Item = {};
    for (const [key, value] of Object.entries(item)) {
      if (!skip.has(key) && value !== undefined) copy[key] = value;
    }
    return normalize(copy);
  };
  return JSON.stringify(pick(existing)) === JSON.stringify(pick(expected));
}

function isConditional(error: unknown): boolean {
  return error instanceof Error && error.name === "ConditionalCheckFailedException";
}

async function putNew(
  client: DynamoDBDocumentClient,
  tableName: string,
  item: Item,
  ignore: string[] = []
): Promise<"created" | "skipped"> {
  try {
    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: item,
        ConditionExpression: "attribute_not_exists(PK)",
      })
    );
    return "created";
  } catch (error) {
    if (!isConditional(error)) throw error;
    const current = await client.send(
      new GetCommand({
        TableName: tableName,
        Key: { PK: item.PK, SK: item.SK },
        ConsistentRead: true,
      })
    );
    if (!sameItem(current.Item as Item | undefined, item, ignore)) {
      throw new MigrationError(
        `Refusing to overwrite existing item ${String(item.PK)} / ${String(item.SK)}`,
        "would_overwrite"
      );
    }
    return "skipped";
  }
}

function copyString(item: Item, key: string): string | undefined {
  return typeof item[key] === "string" ? item[key] : undefined;
}

function effectiveCard(item: Item, deckId: string): Card {
  const modes = item.modes as Card["modes"];
  const adjustedModes = modes
    ? {
        ...modes,
        ...(modes.write ? { write: { ...modes.write, fsrs: currentRetentionSchedule(modes.write.fsrs) } } : {}),
        ...(modes.pinyin
          ? { pinyin: { ...modes.pinyin, fsrs: currentRetentionSchedule(modes.pinyin.fsrs) } }
          : {}),
      }
    : undefined;
  return {
    id: cardIdOf(item),
    deckId,
    front: String(item.front ?? ""),
    back: String(item.back ?? ""),
    ...(copyString(item, "notes") ? { notes: copyString(item, "notes") } : {}),
    createdAt: String(item.createdAt),
    updatedAt: String(item.updatedAt),
    fsrs: currentRetentionSchedule(item.fsrs as StoredFsrs),
    ...(adjustedModes ? { modes: adjustedModes } : {}),
    ...(item.practice ? { practice: item.practice as Card["practice"] } : {}),
    ...(item.hard === true ? { hard: true } : {}),
  };
}

function contentItem(card: Item, source: Source, deckId: string, userId: string): Item {
  return {
    ...(source === "global"
      ? { PK: `GLOBAL#DECK#${deckId}`, SK: `CARD#${cardIdOf(card)}` }
      : { PK: `USER#${userId}#DECK#${deckId}`, SK: `CARD#${cardIdOf(card)}` }),
    source,
    front: card.front,
    back: card.back,
    notes: copyString(card, "notes"),
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
    contentVersion: 1,
  };
}

function progressItem(card: Item, source: Source, userId: string, deckId: string): Item {
  return {
    PK: `USER#${userId}`,
    SK: `PROGRESS#${source.toUpperCase()}#${deckId}#CARD#${cardIdOf(card)}`,
    source,
    deckId,
    cardId: cardIdOf(card),
    fsrs: card.fsrs,
    modes: card.modes,
    practice: card.practice,
    hard: typeof card.hard === "boolean" ? card.hard : undefined,
    reviewVersion: typeof card.reviewVersion === "number" ? card.reviewVersion : undefined,
    updatedAt: card.updatedAt,
  };
}

async function loadLegacy(
  client: DynamoDBDocumentClient,
  tableName: string
): Promise<LegacySnapshot> {
  const decks = (await queryPartition(client, tableName, "DECKS")).filter(
    (item) => typeof item.deletingAt !== "string"
  );
  const cards: Item[] = [];
  for (const deck of decks) {
    cards.push(...(await queryPartition(client, tableName, `DECK#${deckIdOf(deck)}`, "CARD#")));
  }
  const logs = await queryPartition(client, tableName, "LOGS");
  const receipts = await queryPartition(client, tableName, "REVIEW_REQUESTS");
  const statsResponse = await client.send(
    new GetCommand({
      TableName: tableName,
      Key: { PK: "META", SK: "STATS" },
      ConsistentRead: true,
    })
  );
  return { decks, cards, logs, receipts, stats: (statsResponse.Item as Item | undefined) ?? null };
}

function legacyItems(snapshot: LegacySnapshot): Item[] {
  return [
    ...snapshot.decks,
    ...snapshot.cards,
    ...snapshot.logs,
    ...snapshot.receipts,
    ...(snapshot.stats ? [snapshot.stats] : []),
  ];
}

function sourceForHistory(
  item: Item,
  config: MigrationConfig,
  cardDecks: Map<string, string>
): Source {
  const deckId =
    typeof item.deckId === "string" && item.deckId
      ? item.deckId
      : cardDecks.get(String(item.cardId ?? ""));
  if (!deckId || (config.decks[deckId] !== "global" && config.decks[deckId] !== "private")) {
    throw new MigrationError(
      `Cannot classify review history ${String(item.PK)} / ${String(item.SK)} because its deck is missing or unclassified`,
      "unclassified_decks"
    );
  }
  return config.decks[deckId];
}

export async function migrateMultiUser(options: {
  tableName: string;
  endpoint?: string;
  region?: string;
  config: MigrationConfig;
  now?: Date;
  dryRun?: boolean;
}): Promise<MigrationReport> {
  assertSafeMigrationTarget(options.tableName, options.endpoint);
  assertConfig(options.config);
  const client = clientFor(options.endpoint, options.region || process.env.APP_REGION || "us-east-1");
  const snapshot = await loadLegacy(client, options.tableName);
  validateDeckClassification(snapshot.decks.map(deckIdOf), options.config.decks);
  const cardDecks = new Map(snapshot.cards.map((card) => [cardIdOf(card), String(card.PK).slice("DECK#".length)]));
  for (const item of [...snapshot.logs, ...snapshot.receipts]) sourceForHistory(item, options.config, cardDecks);

  const beforeCards = snapshot.cards.map((card) => effectiveCard(card, String(card.PK).slice("DECK#".length)));
  const beforeCounts = totalCounts(beforeCards, options.now ?? new Date());
  const hardMarkerCount = snapshot.cards.filter((card) => card.hard === true).length;
  const globalDeckCount = snapshot.decks.filter((deck) => options.config.decks[deckIdOf(deck)] === "global").length;
  const privateDeckCount = snapshot.decks.length - globalDeckCount;
  const report: MigrationReport = {
    sourceDeckCount: snapshot.decks.length,
    globalDeckCount,
    privateDeckCount,
    sourceCardCount: snapshot.cards.length,
    migratedContentCount: snapshot.decks.length + snapshot.cards.length,
    migratedProgressCount: snapshot.cards.length,
    reviewLogCount: snapshot.logs.length,
    reviewReceiptCount: snapshot.receipts.length,
    hardMarkerCount,
    dueBefore: beforeCounts.due,
    dueAfter: beforeCounts.due,
    newBefore: beforeCounts.newCards,
    newAfter: beforeCounts.newCards,
    createdCount: 0,
    skippedExisting: 0,
    legacyRecordsRetained: legacyItems(snapshot).length,
  };
  if (options.dryRun) return report;

  const beforeFingerprint = fingerprint(legacyItems(snapshot));
  const now = (options.now ?? new Date()).toISOString();
  const userId = options.config.naijeiUserId;
  const tally = async (item: Item, ignore: string[] = []) => {
    const result = await putNew(client, options.tableName, item, ignore);
    if (result === "created") report.createdCount += 1;
    else report.skippedExisting += 1;
  };

  const privateCards = snapshot.cards.filter(
    (card) => options.config.decks[String(card.PK).slice("DECK#".length)] === "private"
  );
  await tally(profileItem(userId, "user", options.config.naijeiEmail, "Naijei", now), ["createdAt"]);
  await tally(profileItem(options.config.adminUserId, "admin", options.config.adminEmail, "Admin", now), ["createdAt"]);
  await tally(
    directoryItem({
      userId,
      email: options.config.naijeiEmail,
      role: "user",
      createdAt: now,
      reviewCount: reviewCountOf(snapshot),
      lastReviewAt: latestReview(snapshot.logs),
      privateDeckCount,
      privateCardCount: privateCards.length,
    }),
    ["createdAt"]
  );
  await tally(
    directoryItem({
      userId: options.config.adminUserId,
      email: options.config.adminEmail,
      role: "admin",
      createdAt: now,
      reviewCount: 0,
      privateDeckCount: 0,
      privateCardCount: 0,
    }),
    ["createdAt"]
  );

  for (const deck of snapshot.decks) {
    const id = deckIdOf(deck);
    const source = options.config.decks[id];
    await tally({
      ...(source === "global"
        ? { PK: "GLOBAL#DECKS", SK: `DECK#${id}` }
        : { PK: `USER#${userId}#DECKS`, SK: `DECK#${id}` }),
      source,
      name: deck.name,
      frontLanguage: copyString(deck, "frontLanguage"),
      backLanguage: copyString(deck, "backLanguage"),
      chineseSide: deck.chineseSide === "front" || deck.chineseSide === "back" ? deck.chineseSide : undefined,
      createdAt: deck.createdAt,
      updatedAt: deck.updatedAt,
    });
  }

  for (const card of snapshot.cards) {
    const deckId = String(card.PK).slice("DECK#".length);
    const source = options.config.decks[deckId];
    const content = contentItem(card, source, deckId, userId);
    await tally(content);
    await tally(progressItem(card, source, userId, deckId));
  }

  for (const log of snapshot.logs) {
    const source = sourceForHistory(log, options.config, cardDecks);
    const deckId = typeof log.deckId === "string" ? log.deckId : cardDecks.get(String(log.cardId));
    const { PK, SK, ...fields } = log;
    void PK;
    void SK;
    await tally({
      PK: `USER#${userId}#LOGS`,
      SK: `${String(log.reviewedAt)}#${source}#${deckId}#${String(log.cardId)}#${String(log.clientReviewId)}`,
      ...fields,
      source,
      deckId,
    });
  }

  for (const receipt of snapshot.receipts) {
    const source = sourceForHistory(receipt, options.config, cardDecks);
    const { PK, SK, ...fields } = receipt;
    void PK;
    void SK;
    await tally({
      PK: `USER#${userId}#REVIEW_REQUESTS`,
      SK: String(receipt.SK),
      ...fields,
      source,
    });
  }

  await tally({
    PK: `USER#${userId}#META`,
    SK: "STATS",
    reviewCount: reviewCountOf(snapshot),
    reviewCountVersion:
      typeof snapshot.stats?.reviewCountVersion === "number" ? snapshot.stats.reviewCountVersion : undefined,
    updatedAt: copyString(snapshot.stats ?? {}, "updatedAt"),
    lastReviewAt: latestReview(snapshot.logs),
  });

  const after = await loadLegacy(client, options.tableName);
  if (fingerprint(legacyItems(after)) !== beforeFingerprint) {
    throw new MigrationError("Legacy records changed. Migration must only write new keys.", "legacy_modified");
  }
  await verifyProgress(client, options.tableName, snapshot, options.config);
  await verifyAdminHasNoStudyData(client, options.tableName, options.config.adminUserId);
  const afterCards = await loadEffectiveCards(client, options.tableName, snapshot, options.config);
  const afterCounts = totalCounts(afterCards, options.now ?? new Date());
  report.dueAfter = afterCounts.due;
  report.newAfter = afterCounts.newCards;
  if (report.dueBefore !== report.dueAfter || report.newBefore !== report.newAfter) {
    throw new MigrationError(
      `Due/new counts changed for Naijei (due ${report.dueBefore} -> ${report.dueAfter}, new ${report.newBefore} -> ${report.newAfter})`,
      "count_mismatch"
    );
  }
  return report;
}

function profileItem(
  userId: string,
  role: "user" | "admin",
  email: string | undefined,
  displayName: string,
  createdAt: string
): Item {
  return {
    PK: `USER#${userId}`,
    SK: "PROFILE",
    email,
    displayName: email ?? displayName,
    role,
    status: "active",
    createdAt,
  };
}

function directoryItem(input: {
  userId: string;
  email?: string;
  role: "user" | "admin";
  createdAt: string;
  reviewCount: number;
  lastReviewAt?: string;
  privateDeckCount: number;
  privateCardCount: number;
}): Item {
  return {
    PK: "USERS",
    SK: `USER#${input.userId}`,
    email: input.email,
    role: input.role,
    status: "active",
    createdAt: input.createdAt,
    reviewCount: input.reviewCount,
    lastReviewAt: input.lastReviewAt,
    privateDeckCount: input.privateDeckCount,
    privateCardCount: input.privateCardCount,
  };
}

function reviewCountOf(snapshot: LegacySnapshot): number {
  return typeof snapshot.stats?.reviewCount === "number" ? snapshot.stats.reviewCount : snapshot.logs.length;
}

function latestReview(logs: Item[]): string | undefined {
  const stamps = logs
    .map((log) => log.reviewedAt)
    .filter((value): value is string => typeof value === "string")
    .sort();
  return stamps.at(-1);
}

async function verifyProgress(
  client: DynamoDBDocumentClient,
  tableName: string,
  snapshot: LegacySnapshot,
  config: MigrationConfig
): Promise<void> {
  for (const card of snapshot.cards) {
    const deckId = String(card.PK).slice("DECK#".length);
    const source = config.decks[deckId];
    const expected = progressItem(card, source, config.naijeiUserId, deckId);
    const stored = await client.send(
      new GetCommand({
        TableName: tableName,
        Key: { PK: expected.PK, SK: expected.SK },
        ConsistentRead: true,
      })
    );
    if (!sameItem(stored.Item as Item | undefined, expected)) {
      throw new MigrationError(
        `Progress for card ${cardIdOf(card)} does not match the legacy FSRS/mode/hard state`,
        "progress_mismatch"
      );
    }
    const content = contentItem(card, source, deckId, config.naijeiUserId);
    const storedContent = await client.send(
      new GetCommand({ TableName: tableName, Key: { PK: content.PK, SK: content.SK }, ConsistentRead: true })
    );
    const contentRecord = storedContent.Item as Item | undefined;
    if (contentRecord?.fsrs || contentRecord?.modes || contentRecord?.hard || contentRecord?.practice) {
      throw new MigrationError(`Content item for card ${cardIdOf(card)} still contains progress fields`);
    }
  }
}

async function verifyAdminHasNoStudyData(
  client: DynamoDBDocumentClient,
  tableName: string,
  adminUserId: string
): Promise<void> {
  const checks: Array<[string, string?]> = [
    [`USER#${adminUserId}`],
    [`USER#${adminUserId}#LOGS`],
    [`USER#${adminUserId}#REVIEW_REQUESTS`],
    [`USER#${adminUserId}#DECKS`],
    [`USER#${adminUserId}#META`, "STATS"],
  ];
  for (const [pk, sk] of checks) {
    if (sk) {
      const item = await client.send(
        new GetCommand({ TableName: tableName, Key: { PK: pk, SK: sk }, ConsistentRead: true })
      );
      if (item.Item) throw new MigrationError("Admin account received study stats");
      continue;
    }
    const items = await queryPartition(client, tableName, pk);
    if (items.some((item) => item.SK !== "PROFILE")) {
      throw new MigrationError("Admin account received study or progress records");
    }
  }
}

async function loadEffectiveCards(
  client: DynamoDBDocumentClient,
  tableName: string,
  snapshot: LegacySnapshot,
  config: MigrationConfig
): Promise<Card[]> {
  const cards: Card[] = [];
  for (const card of snapshot.cards) {
    const deckId = String(card.PK).slice("DECK#".length);
    const source = config.decks[deckId];
    const progress = progressItem(card, source, config.naijeiUserId, deckId);
    const stored = await client.send(
      new GetCommand({
        TableName: tableName,
        Key: { PK: progress.PK, SK: progress.SK },
        ConsistentRead: true,
      })
    );
    const progressRecord = (stored.Item ?? {}) as Item;
    cards.push(
      effectiveCard(
        {
          ...card,
          fsrs: progressRecord.fsrs,
          modes: progressRecord.modes,
          practice: progressRecord.practice,
          hard: progressRecord.hard,
        },
        deckId
      )
    );
  }
  return cards;
}
