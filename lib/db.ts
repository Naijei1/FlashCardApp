import { currentRetentionSchedule } from "./fsrs";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  type QueryCommandInput,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  BatchGetCommand,
  BatchWriteCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import type { Card, Deck, ReviewMode } from "./types";
import type { ReviewLog } from "ts-fsrs";
import { authMode, currentAuthSessionOrLegacy, type AuthSession } from "./auth";
import { emptyCardState } from "./fsrs";

// On Amplify Hosting the SSR compute role supplies credentials via the default
// chain; locally the ~/.aws profile or DYNAMODB_ENDPOINT (DynamoDB Local) is used.
function createClient(): DynamoDBDocumentClient {
  const endpoint = process.env.DYNAMODB_ENDPOINT;
  const client = new DynamoDBClient({
    region: process.env.APP_REGION || "us-east-1",
    ...(endpoint
      ? {
          endpoint,
          credentials: { accessKeyId: "local", secretAccessKey: "local" },
        }
      : {}),
  });
  return DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true },
  });
}

const globalForDb = globalThis as unknown as { __ddb?: DynamoDBDocumentClient };
const db = (globalForDb.__ddb ??= createClient());
const SLOW_DB_OPERATION_MS = 500;

async function observeDbLatency<T>(operation: string, work: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  try {
    return await work();
  } finally {
    const durationMs = Date.now() - startedAt;
    if (durationMs >= SLOW_DB_OPERATION_MS) {
      // Do not include keys, expressions, request bodies, or table names: this
      // diagnostic is intentionally safe to emit to shared hosting logs.
      console.warn("Slow DynamoDB operation", { operation, durationMs });
    }
  }
}

function tableName(): string {
  const name = process.env.TABLE_NAME;
  if (!name) throw new Error("TABLE_NAME is not set");
  return name;
}

type Item = Record<string, unknown>;

const deckKey = (id: string) => ({ PK: "DECKS", SK: `DECK#${id}` });
const cardKey = (deckId: string, id: string) => ({
  PK: `DECK#${deckId}`,
  SK: `CARD#${id}`,
});
type CardSource = "global" | "private";
type DbScope = { mode: "legacy" } | { mode: "multi"; user: AuthSession };

async function resolveScope(session?: AuthSession): Promise<DbScope> {
  if (authMode() === "shared") return { mode: "legacy" };
  return { mode: "multi", user: session ?? (await currentAuthSessionOrLegacy()) };
}

const globalDeckKey = (id: string) => ({ PK: "GLOBAL#DECKS", SK: `DECK#${id}` });
const privateDeckKey = (userId: string, id: string) => ({
  PK: `USER#${userId}#DECKS`,
  SK: `DECK#${id}`,
});
const contentDeckKey = (scope: DbScope, deck: Pick<Deck, "id" | "source">) =>
  scope.mode === "legacy"
    ? deckKey(deck.id)
    : (deck.source ?? (scope.user.isAdmin ? "global" : "private")) === "global"
      ? globalDeckKey(deck.id)
      : privateDeckKey(scope.user.userId, deck.id);
const globalCardKey = (deckId: string, id: string) => ({
  PK: `GLOBAL#DECK#${deckId}`,
  SK: `CARD#${id}`,
});
const privateCardKey = (userId: string, deckId: string, id: string) => ({
  PK: `USER#${userId}#DECK#${deckId}`,
  SK: `CARD#${id}`,
});
const progressKey = (userId: string, source: CardSource, deckId: string, cardId: string) => ({
  PK: `USER#${userId}`,
  SK: `PROGRESS#${source.toUpperCase()}#${deckId}#CARD#${cardId}`,
});
const hiddenDeckKey = (userId: string, deckId: string) => ({
  PK: `USER#${userId}`,
  SK: `HIDDEN#GLOBAL#DECK#${deckId}`,
});
const hiddenCardKey = (userId: string, deckId: string, cardId: string) => ({
  PK: `USER#${userId}`,
  SK: `HIDDEN#GLOBAL#${deckId}#CARD#${cardId}`,
});
const reviewLogKey = (
  reviewedAt: string,
  cardId: string,
  clientReviewId: string
) => ({
  PK: "LOGS",
  // Keep the established chronological key prefix so existing/future range
  // queries continue to include new logs. The client id prevents collisions.
  SK: `${reviewedAt}#${cardId}#${clientReviewId}`,
});
const reviewReceiptKey = (clientReviewId: string) => ({
  PK: "REVIEW_REQUESTS",
  SK: clientReviewId,
});
const reviewStatsKey = { PK: "META", SK: "STATS" } as const;
const userReviewLogKey = (
  userId: string,
  reviewedAt: string,
  source: CardSource,
  deckId: string,
  cardId: string,
  clientReviewId: string
) => ({
  PK: `USER#${userId}#LOGS`,
  SK: `${reviewedAt}#${source}#${deckId}#${cardId}#${clientReviewId}`,
});
const userReviewReceiptKey = (userId: string, clientReviewId: string) => ({
  PK: `USER#${userId}#REVIEW_REQUESTS`,
  SK: clientReviewId,
});
const userReviewStatsKey = (userId: string) => ({ PK: `USER#${userId}#META`, SK: "STATS" });

function activeDeckCheck(deckId: string) {
  return {
    ConditionCheck: {
      TableName: tableName(),
      Key: deckKey(deckId),
      ConditionExpression:
        "attribute_exists(#pk) AND attribute_not_exists(#deletingAt)",
      ExpressionAttributeNames: { "#pk": "PK", "#deletingAt": "deletingAt" },
    },
  };
}

export class ContentAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContentAccessError";
  }
}

function contentSource(scope: Extract<DbScope, { mode: "multi" }>, source?: CardSource): CardSource {
  return source ?? (scope.user.isAdmin ? "global" : "private");
}

function assertCanMutateContent(scope: DbScope, source: CardSource): void {
  if (scope.mode === "legacy") return;
  if (source === "global" && !scope.user.isAdmin) {
    throw new ContentAccessError("Only an admin can change global content");
  }
  if (source === "private" && scope.user.isAdmin) {
    throw new ContentAccessError("Admin accounts cannot change private user content");
  }
}

function contentAttributes(card: Card, source: CardSource): Item {
  return {
    source,
    front: card.front,
    back: card.back,
    notes: card.notes,
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
    contentVersion: 1,
  };
}

function activeContentDeckCheck(scope: DbScope, deck: Pick<Deck, "id" | "source">) {
  if (scope.mode === "legacy") return activeDeckCheck(deck.id);
  return {
    ConditionCheck: {
      TableName: tableName(),
      Key: contentDeckKey(scope, deck),
      ConditionExpression:
        "attribute_exists(#pk) AND attribute_not_exists(#deletingAt) AND attribute_not_exists(#archivedAt)",
      ExpressionAttributeNames: {
        "#pk": "PK",
        "#deletingAt": "deletingAt",
        "#archivedAt": "archivedAt",
      },
    },
  };
}

// Keep optimistic-lock metadata outside the public card object. Even a
// non-enumerable symbol causes React Server Component serialization warnings.
const cardReviewVersions = new WeakMap<Card, number | null>();

function toDeck(item: Item): Deck {
  const { PK, SK, deletingAt, ...rest } = item;
  void PK;
  void deletingAt;
  return { ...(rest as Omit<Deck, "id">), id: (SK as string).slice("DECK#".length) };
}

function toDeckWithSource(item: Item, source: CardSource): Deck {
  return { ...toDeck(item), source };
}

function toCard(item: Item): Card {
  const { PK, SK, reviewVersion, ...rest } = item;
  const card: Card = {
    ...(rest as Omit<Card, "id" | "deckId">),
    deckId: (PK as string).slice("DECK#".length),
    id: (SK as string).slice("CARD#".length),
  };
  card.fsrs = currentRetentionSchedule(card.fsrs);
  for (const mode of ["write", "pinyin"] as const) {
    const state = card.modes?.[mode];
    if (state) card.modes = { ...card.modes, [mode]: { ...state, fsrs: currentRetentionSchedule(state.fsrs) } };
  }
  cardReviewVersions.set(
    card,
    typeof reviewVersion === "number" && Number.isSafeInteger(reviewVersion)
      ? reviewVersion
      : null
  );
  return card;
}

function toContentCard(item: Item, source: CardSource): Card {
  const {
    PK,
    SK,
    reviewVersion,
    fsrs,
    modes,
    practice,
    hard,
    hidden,
    contentVersionSeen,
    contentVersion,
    archivedAt,
    source: _source,
    ...rest
  } = item;
  void reviewVersion;
  void fsrs;
  void modes;
  void practice;
  void hard;
  void hidden;
  void contentVersionSeen;
  void contentVersion;
  void archivedAt;
  void _source;
  const marker = "#DECK#";
  const deckId =
    source === "global"
      ? (PK as string).slice("GLOBAL#DECK#".length)
      : (PK as string).slice((PK as string).lastIndexOf(marker) + marker.length);
  return {
    ...(rest as Omit<Card, "id" | "deckId" | "source" | "fsrs">),
    deckId,
    id: (SK as string).slice("CARD#".length),
    source,
    fsrs: emptyCardState(new Date((rest.createdAt as string) || new Date().toISOString())),
  };
}

function mergeProgress(content: Card, progress?: Item): Card {
  const createdAt = new Date(content.createdAt);
  const card: Card = {
    ...content,
    fsrs:
      progress?.fsrs && typeof progress.fsrs === "object"
        ? currentRetentionSchedule(progress.fsrs as Card["fsrs"])
        : emptyCardState(createdAt),
    modes: progress?.modes as Card["modes"],
    practice: progress?.practice as Card["practice"],
    hard: progress?.hard === true,
  };
  if (!card.hard) delete card.hard;
  if (!card.modes) delete card.modes;
  else {
    const modes = { ...card.modes };
    for (const mode of ["write", "pinyin"] as const) {
      const state = modes[mode];
      if (state) modes[mode] = { ...state, fsrs: currentRetentionSchedule(state.fsrs) };
    }
    card.modes = modes;
  }
  if (!card.practice) delete card.practice;
  cardReviewVersions.set(
    card,
    typeof progress?.reviewVersion === "number" && Number.isSafeInteger(progress.reviewVersion)
      ? progress.reviewVersion
      : null
  );
  return card;
}

function progressFieldsFromCard(card: Card): Item {
  return {
    source: card.source ?? "private",
    deckId: card.deckId,
    cardId: card.id,
    fsrs: card.fsrs,
    modes: card.modes,
    practice: card.practice,
    hard: card.hard,
    updatedAt: new Date().toISOString(),
  };
}

function reviewVersionOf(card: Card): number | null | undefined {
  return cardReviewVersions.get(card);
}

async function queryAll(input: Omit<QueryCommandInput, "TableName">): Promise<Item[]> {
  const items: Item[] = [];
  let startKey: Item | undefined;
  do {
    const res = await observeDbLatency("query.all", () =>
      db.send(new QueryCommand({ TableName: tableName(), ...input, ExclusiveStartKey: startKey }))
    );
    items.push(...(res.Items ?? []));
    startKey = res.LastEvaluatedKey;
  } while (startKey);
  return items;
}

async function batchGetProgress(
  userId: string,
  source: CardSource,
  deckId: string,
  cardIds: string[]
): Promise<Item[]> {
  const items: Item[] = [];
  for (let index = 0; index < cardIds.length; index += 100) {
    const Keys = cardIds
      .slice(index, index + 100)
      .map((cardId) => progressKey(userId, source, deckId, cardId));
    if (Keys.length === 0) continue;
    const res = await db.send(
      new BatchGetCommand({
        RequestItems: { [tableName()]: { Keys, ConsistentRead: true } },
      })
    );
    items.push(...((res.Responses?.[tableName()] as Item[] | undefined) ?? []));
  }
  return items;
}

export async function listDecks(session?: AuthSession): Promise<Deck[]> {
  const scope = await resolveScope(session);
  if (scope.mode === "multi") {
    const [globalItems, privateItems, hiddenItems] = await Promise.all([
      queryAll({
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: { ":pk": "GLOBAL#DECKS" },
        ConsistentRead: true,
      }),
      scope.user.isAdmin
        ? Promise.resolve([])
        : queryAll({
            KeyConditionExpression: "PK = :pk",
            ExpressionAttributeValues: { ":pk": `USER#${scope.user.userId}#DECKS` },
            ConsistentRead: true,
          }),
      scope.user.isAdmin
        ? Promise.resolve([])
        : queryAll({
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues: {
              ":pk": `USER#${scope.user.userId}`,
              ":sk": "HIDDEN#GLOBAL#DECK#",
            },
            ConsistentRead: true,
          }),
    ]);
    const hiddenDeckIds = new Set(
      hiddenItems
        .map((item) => item.SK as string)
        .filter((key) => /^HIDDEN#GLOBAL#DECK#[^#]+$/.test(key))
        .map((key) => key.slice("HIDDEN#GLOBAL#DECK#".length))
    );
    return [
      ...globalItems
        .filter((item) => typeof item.archivedAt !== "string" && !hiddenDeckIds.has((item.SK as string).slice("DECK#".length)))
        .map((item) => toDeckWithSource(item, "global")),
      ...privateItems
        .filter((item) => typeof item.archivedAt !== "string")
        .map((item) => toDeckWithSource(item, "private")),
    ].sort((a, b) => a.name.localeCompare(b.name));
  }
  const items: Item[] = [];
  let startKey: Item | undefined;
  do {
    const res = await observeDbLatency("decks.list", () =>
      db.send(
        new QueryCommand({
          TableName: tableName(),
          KeyConditionExpression: "PK = :pk",
          ExpressionAttributeValues: { ":pk": "DECKS" },
          ConsistentRead: true,
          ExclusiveStartKey: startKey,
        })
      )
    );
    items.push(...(res.Items ?? []));
    startKey = res.LastEvaluatedKey;
  } while (startKey);
  return items
    .filter((item) => typeof item.deletingAt !== "string")
    .map(toDeck)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getDeck(
  id: string,
  session?: AuthSession,
  options: { includeHidden?: boolean } = {}
): Promise<Deck | null> {
  const scope = await resolveScope(session);
  if (scope.mode === "multi") {
    const hidden =
      !options.includeHidden &&
      !scope.user.isAdmin &&
      (await db.send(
        new GetCommand({
          TableName: tableName(),
          Key: hiddenDeckKey(scope.user.userId, id),
          ConsistentRead: true,
        })
      )).Item;
    if (hidden) return null;
    const global = await db.send(
      new GetCommand({ TableName: tableName(), Key: globalDeckKey(id), ConsistentRead: true })
    );
    if (global.Item && typeof global.Item.archivedAt !== "string") {
      return toDeckWithSource(global.Item, "global");
    }
    if (!scope.user.isAdmin) {
      const privateDeck = await db.send(
        new GetCommand({
          TableName: tableName(),
          Key: privateDeckKey(scope.user.userId, id),
          ConsistentRead: true,
        })
      );
      if (privateDeck.Item && typeof privateDeck.Item.archivedAt !== "string") {
        return toDeckWithSource(privateDeck.Item, "private");
      }
    }
    return null;
  }
  const res = await db.send(
    new GetCommand({ TableName: tableName(), Key: deckKey(id), ConsistentRead: true })
  );
  return res.Item && typeof res.Item.deletingAt !== "string" ? toDeck(res.Item) : null;
}

export async function putDeck(
  deck: Deck,
  options: { create?: boolean; session?: AuthSession } = {}
): Promise<void> {
  const scope = await resolveScope(options.session);
  const source = scope.mode === "multi" ? contentSource(scope, deck.source) : undefined;
  if (source) assertCanMutateContent(scope, source);
  const { id, source: _source, ...rest } = deck;
  void _source;
  await db.send(
    new PutCommand({
      TableName: tableName(),
      Item: {
        ...(scope.mode === "legacy" ? deckKey(id) : contentDeckKey(scope, { id, source })),
        ...rest,
        ...(source ? { source } : {}),
      },
      ConditionExpression: options.create
        ? "attribute_not_exists(#pk)"
        : "attribute_exists(#pk) AND attribute_not_exists(#deletingAt)",
      ExpressionAttributeNames: options.create
        ? { "#pk": "PK" }
        : { "#pk": "PK", "#deletingAt": "deletingAt" },
    })
  );
}

export async function listCards(
  deckId: string,
  options: { consistent?: boolean; session?: AuthSession } = {}
): Promise<Card[]> {
  const scope = await resolveScope(options.session);
  if (scope.mode === "multi") {
    const deck = await getDeck(deckId, scope.user);
    if (!deck) return [];
    const source = deck.source ?? "global";
    const contentItems = await queryAll({
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": source === "global" ? `GLOBAL#DECK#${deckId}` : `USER#${scope.user.userId}#DECK#${deckId}`,
        ":sk": "CARD#",
      },
      ConsistentRead: options.consistent || undefined,
    });
    const visibleContent = contentItems.filter((item) => typeof item.archivedAt !== "string");
    const [hiddenItems, progressItems] = await Promise.all([
      source === "global" && !scope.user.isAdmin
        ? queryAll({
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues: {
              ":pk": `USER#${scope.user.userId}`,
              ":sk": `HIDDEN#GLOBAL#${deckId}#CARD#`,
            },
            ConsistentRead: options.consistent || undefined,
          })
        : Promise.resolve([]),
      scope.user.isAdmin
        ? Promise.resolve([])
        : batchGetProgress(scope.user.userId, source, deckId, visibleContent.map((item) => (item.SK as string).slice("CARD#".length))),
    ]);
    const hiddenIds = new Set(
      hiddenItems.map((item) => (item.SK as string).slice(`HIDDEN#GLOBAL#${deckId}#CARD#`.length))
    );
    const progressByCard = new Map(progressItems.map((item) => [item.cardId as string, item]));
    return visibleContent
      .map((item) => toContentCard(item, source))
      .filter((card) => !hiddenIds.has(card.id))
      .map((card) => mergeProgress(card, progressByCard.get(card.id)));
  }
  const items: Item[] = [];
  let startKey: Item | undefined;
  do {
    const res = await observeDbLatency("cards.list", () =>
      db.send(
        new QueryCommand({
          TableName: tableName(),
          KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
          ExpressionAttributeValues: { ":pk": `DECK#${deckId}`, ":sk": "CARD#" },
          ConsistentRead: options.consistent || undefined,
          ExclusiveStartKey: startKey,
        })
      )
    );
    items.push(...(res.Items ?? []));
    startKey = res.LastEvaluatedKey;
  } while (startKey);
  return items.map(toCard);
}

/**
 * Lists cards without scanning unrelated review logs and metadata. Deck
 * partitions are queried concurrently, with a small cap to avoid a burst when
 * the collection grows. Passing already-loaded decks avoids another read.
 */
export async function listAllCards(
  decks?: readonly Pick<Deck, "id">[],
  options: { consistent?: boolean; session?: AuthSession } = {}
): Promise<Card[]> {
  const sourceDecks = decks ?? (await listDecks(options.session));
  const cardsByDeck: Card[][] = new Array(sourceDecks.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < sourceDecks.length) {
      const index = nextIndex++;
      cardsByDeck[index] = await listCards(sourceDecks[index].id, options);
    }
  }

  const workerCount = Math.min(4, sourceDecks.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return cardsByDeck.flat();
}

export async function getCard(
  deckId: string,
  id: string,
  session?: AuthSession,
  options: { includeHidden?: boolean } = {}
): Promise<Card | null> {
  const scope = await resolveScope(session);
  if (scope.mode === "multi") {
    const deck = await getDeck(deckId, scope.user, options);
    if (!deck) return null;
    const source = deck.source ?? "global";
    if (
      !options.includeHidden &&
      source === "global" &&
      !scope.user.isAdmin &&
      (await db.send(
        new GetCommand({
          TableName: tableName(),
          Key: hiddenCardKey(scope.user.userId, deckId, id),
          ConsistentRead: true,
        })
      )).Item
    ) {
      return null;
    }
    const contentKey =
      source === "global"
        ? globalCardKey(deckId, id)
        : privateCardKey(scope.user.userId, deckId, id);
    const content = await observeDbLatency("card.get", () =>
      db.send(
        new GetCommand({
          TableName: tableName(),
          Key: contentKey,
          ConsistentRead: true,
        })
      )
    );
    if (!content.Item || typeof content.Item.archivedAt === "string") return null;
    const progress =
      scope.user.isAdmin
        ? undefined
        : (
            await db.send(
              new GetCommand({
                TableName: tableName(),
                Key: progressKey(scope.user.userId, source, deckId, id),
                ConsistentRead: true,
              })
            )
          ).Item;
    return mergeProgress(toContentCard(content.Item, source), progress);
  }
  const res = await observeDbLatency("card.get", () =>
    db.send(
      new GetCommand({
        TableName: tableName(),
        Key: cardKey(deckId, id),
        ConsistentRead: true,
      })
    )
  );
  return res.Item ? toCard(res.Item) : null;
}

export async function putCard(card: Card, session?: AuthSession): Promise<void> {
  const scope = await resolveScope(session);
  if (scope.mode === "multi") {
    const source = contentSource(scope, card.source);
    assertCanMutateContent(scope, source);
    const { id, deckId, fsrs, modes, practice, hard, source: _source, ...content } = card;
    void fsrs;
    void modes;
    void practice;
    void hard;
    void _source;
    await db.send(
      new UpdateCommand({
        TableName: tableName(),
        Key:
          source === "global"
            ? globalCardKey(deckId, id)
            : privateCardKey(scope.user.userId, deckId, id),
        UpdateExpression:
          "SET #front = :front, #back = :back, #createdAt = :createdAt, #updatedAt = :updatedAt, #source = :source" +
          (content.notes !== undefined ? ", #notes = :notes" : " REMOVE #notes"),
        ConditionExpression: "attribute_exists(#pk) AND attribute_exists(#sk)",
        ExpressionAttributeNames: {
          "#pk": "PK",
          "#sk": "SK",
          "#front": "front",
          "#back": "back",
          "#createdAt": "createdAt",
          "#updatedAt": "updatedAt",
          "#source": "source",
          "#notes": "notes",
        },
        ExpressionAttributeValues: {
          ":front": content.front,
          ":back": content.back,
          ":createdAt": content.createdAt,
          ":updatedAt": content.updatedAt,
          ":source": source,
          ...(content.notes !== undefined ? { ":notes": content.notes } : {}),
        },
      })
    );
    return;
  }
  const { id, deckId } = card;
  const version = reviewVersionOf(card);
  const expressionAttributeNames: Record<string, string> = {
    "#front": "front",
    "#back": "back",
    "#createdAt": "createdAt",
    "#updatedAt": "updatedAt",
    "#fsrs": "fsrs",
    "#notes": "notes",
  };
  const expressionAttributeValues: Record<string, unknown> = {
    ":front": card.front,
    ":back": card.back,
    ":createdAt": card.createdAt,
    ":updatedAt": card.updatedAt,
    ":fsrs": card.fsrs,
  };
  let conditionExpression: string | undefined;
  if (version !== undefined) {
    expressionAttributeNames["#pk"] = "PK";
    expressionAttributeNames["#reviewVersion"] = "reviewVersion";
    conditionExpression =
      version === null
        ? "attribute_exists(#pk) AND attribute_not_exists(#reviewVersion)"
        : "attribute_exists(#pk) AND #reviewVersion = :reviewVersion";
    if (version !== null) expressionAttributeValues[":reviewVersion"] = version;
    expressionAttributeValues[":nextReviewVersion"] = (version ?? 0) + 1;
  }

  const setNotes = card.notes !== undefined;
  if (setNotes) expressionAttributeValues[":notes"] = card.notes;
  await db.send(
    new UpdateCommand({
      TableName: tableName(),
      Key: cardKey(deckId, id),
      UpdateExpression:
        "SET #front = :front, #back = :back, #createdAt = :createdAt, " +
        `#updatedAt = :updatedAt, #fsrs = :fsrs${
          version !== undefined ? ", #reviewVersion = :nextReviewVersion" : ""
        }${setNotes ? ", #notes = :notes" : " REMOVE #notes"}`,
      ConditionExpression: conditionExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
    })
  );
}

type BatchRequest = Record<string, unknown>;

/** BatchWrite can partially succeed; retry UnprocessedItems with backoff. */
async function batchWrite(requests: BatchRequest[]): Promise<void> {
  for (let i = 0; i < requests.length; i += 25) {
    let pending = requests.slice(i, i + 25);
    for (let attempt = 0; pending.length > 0; attempt++) {
      if (attempt >= 8) throw new Error("DynamoDB batch write did not complete");
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, 100 * 2 ** attempt));
      }
      const res = await db.send(
        new BatchWriteCommand({ RequestItems: { [tableName()]: pending } })
      );
      pending = (res.UnprocessedItems?.[tableName()] ?? []) as BatchRequest[];
    }
  }
}

async function createCardChunk(
  cards: Card[],
  skipExisting: boolean
): Promise<void> {
  let pending = cards;
  for (let attempt = 0; pending.length > 0 && attempt < 8; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(25 * 2 ** attempt, 500))
      );
    }
    try {
      await observeDbLatency("cards.create", () =>
        db.send(
          new TransactWriteCommand({
            TransactItems: [
              activeDeckCheck(pending[0].deckId),
              ...pending.map(({ id, deckId, ...rest }) => ({
                Put: {
                  TableName: tableName(),
                  Item: { ...cardKey(deckId, id), ...rest },
                  ConditionExpression: "attribute_not_exists(#pk)",
                  ExpressionAttributeNames: { "#pk": "PK" },
                },
              })),
            ],
          })
        )
      );
      return;
    } catch (error) {
      if (!(error instanceof Error) || error.name !== "TransactionCanceledException") {
        throw error;
      }
      if (!(await getDeck(pending[0].deckId))) {
        const unavailable = new Error("Deck is unavailable");
        unavailable.name = "DeckUnavailableError";
        throw unavailable;
      }
      if (!skipExisting) throw error;
      // A retried import may contain cards committed by an earlier partial
      // response. Strongly identify them and create only the missing cards;
      // never overwrite edits or review progress on an existing card.
      const existing = await Promise.all(
        pending.map((card) =>
          db.send(
            new GetCommand({
              TableName: tableName(),
              Key: cardKey(card.deckId, card.id),
              ConsistentRead: true,
            })
          )
        )
      );
      pending = pending.filter((_, index) => !existing[index].Item);
    }
  }
  if (pending.length > 0) {
    throw new Error("DynamoDB card creation did not complete");
  }
}

async function putContentChunk(
  scope: Extract<DbScope, { mode: "multi" }>,
  source: CardSource,
  cards: Card[],
  skipExisting: boolean
): Promise<void> {
  let pending = cards;
  for (let attempt = 0; pending.length > 0 && attempt < 8; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(25 * 2 ** attempt, 500)));
    try {
      await db.send(
        new TransactWriteCommand({
          TransactItems: [
            activeContentDeckCheck(scope, { id: pending[0].deckId, source }),
            ...pending.map((card) => ({
              Put: {
                TableName: tableName(),
                Item: {
                  ...(source === "global"
                    ? globalCardKey(card.deckId, card.id)
                    : privateCardKey(scope.user.userId, card.deckId, card.id)),
                  ...contentAttributes(card, source),
                },
                ConditionExpression: "attribute_not_exists(#pk)",
                ExpressionAttributeNames: { "#pk": "PK" },
              },
            })),
          ],
        })
      );
      return;
    } catch (error) {
      if (!(error instanceof Error) || error.name !== "TransactionCanceledException") throw error;
      const deck = await getDeck(pending[0].deckId, scope.user);
      if (!deck || deck.source !== source) {
        const unavailable = new Error("Deck is unavailable");
        unavailable.name = "DeckUnavailableError";
        throw unavailable;
      }
      if (!skipExisting) throw error;
      const existing = await Promise.all(
        pending.map((card) =>
          db.send(
            new GetCommand({
              TableName: tableName(),
              Key:
                source === "global"
                  ? globalCardKey(card.deckId, card.id)
                  : privateCardKey(scope.user.userId, card.deckId, card.id),
              ConsistentRead: true,
            })
          )
        )
      );
      pending = pending.filter((_, index) => !existing[index].Item);
    }
  }
  if (pending.length > 0) throw new Error("DynamoDB card creation did not complete");
}

/** Create cards without replacing existing records; imports may skip stable IDs on retry. */
export async function batchPutCards(
  cards: Card[],
  options: { skipExisting?: boolean; session?: AuthSession } = {}
): Promise<void> {
  const scope = await resolveScope(options.session);
  if (scope.mode === "multi") {
    const groups = new Map<string, Card[]>();
    for (const card of cards) {
      const group = groups.get(card.deckId) ?? [];
      group.push(card);
      groups.set(card.deckId, group);
    }
    for (const group of groups.values()) {
      const deck = await getDeck(group[0].deckId, scope.user);
      if (!deck) {
        const unavailable = new Error("Deck is unavailable");
        unavailable.name = "DeckUnavailableError";
        throw unavailable;
      }
      const source = deck.source ?? "private";
      assertCanMutateContent(scope, source);
      for (let index = 0; index < group.length; index += 24) {
        await putContentChunk(scope, source, group.slice(index, index + 24), options.skipExisting === true);
      }
    }
    return;
  }
  const groups = new Map<string, Card[]>();
  for (const card of cards) {
    const group = groups.get(card.deckId) ?? [];
    group.push(card);
    groups.set(card.deckId, group);
  }
  const chunks: Card[][] = [];
  for (const group of groups.values()) {
    for (let index = 0; index < group.length; index += 24) {
      chunks.push(group.slice(index, index + 24));
    }
  }

  let nextChunk = 0;
  async function worker(): Promise<void> {
    while (nextChunk < chunks.length) {
      const chunk = chunks[nextChunk++];
      await createCardChunk(chunk, options.skipExisting === true);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(4, chunks.length) }, () => worker())
  );
}

export async function deleteCard(deckId: string, id: string, session?: AuthSession): Promise<void> {
  const scope = await resolveScope(session);
  if (scope.mode === "multi") {
    const deck = await getDeck(deckId, scope.user);
    if (!deck) return;
    const source = deck.source ?? "global";
    assertCanMutateContent(scope, source);
    await db.send(
      new DeleteCommand({
        TableName: tableName(),
        Key:
          source === "global"
            ? globalCardKey(deckId, id)
            : privateCardKey(scope.user.userId, deckId, id),
      })
    );
    return;
  }
  await db.send(
    new DeleteCommand({ TableName: tableName(), Key: cardKey(deckId, id) })
  );
}

/** Move = PK change, so transactionally delete + put keeping id and FSRS state. */
export async function moveCard(card: Card, toDeckId: string, session?: AuthSession): Promise<Card> {
  const scope = await resolveScope(session);
  if (scope.mode === "multi") {
    const target = await getDeck(toDeckId, scope.user);
    if (!target) throw new Error("Target deck is unavailable");
    const source = card.source ?? target.source ?? (scope.user.isAdmin ? "global" : "private");
    if (source !== (target.source ?? source)) throw new Error("Cannot move cards across content sources");
    assertCanMutateContent(scope, source);
    const moved: Card = { ...card, deckId: toDeckId, source, updatedAt: new Date().toISOString() };
    const oldContentKey =
      source === "global"
        ? globalCardKey(card.deckId, card.id)
        : privateCardKey(scope.user.userId, card.deckId, card.id);
    const newContentKey =
      source === "global"
        ? globalCardKey(toDeckId, card.id)
        : privateCardKey(scope.user.userId, toDeckId, card.id);
    const transactItems: Record<string, unknown>[] = [
      activeContentDeckCheck(scope, { id: card.deckId, source }),
      activeContentDeckCheck(scope, { id: toDeckId, source }),
      { Delete: { TableName: tableName(), Key: oldContentKey } },
      {
        Put: {
          TableName: tableName(),
          Item: { ...newContentKey, ...contentAttributes(moved, source) },
          ConditionExpression: "attribute_not_exists(#pk)",
          ExpressionAttributeNames: { "#pk": "PK" },
        },
      },
    ];
    if (!scope.user.isAdmin) {
      const existingProgress = await db.send(
        new GetCommand({
          TableName: tableName(),
          Key: progressKey(scope.user.userId, source, card.deckId, card.id),
          ConsistentRead: true,
        })
      );
      if (existingProgress.Item) {
        const { PK, SK, ...progress } = existingProgress.Item;
        void PK;
        void SK;
        transactItems.push(
          {
            Delete: {
              TableName: tableName(),
              Key: progressKey(scope.user.userId, source, card.deckId, card.id),
            },
          },
          {
            Put: {
              TableName: tableName(),
              Item: {
                ...progressKey(scope.user.userId, source, toDeckId, card.id),
                ...progress,
                deckId: toDeckId,
              },
              ConditionExpression: "attribute_not_exists(#pk)",
              ExpressionAttributeNames: { "#pk": "PK" },
            },
          }
        );
      }
    }
    await db.send(new TransactWriteCommand({ TransactItems: transactItems }));
    return moved;
  }
  const moved: Card = { ...card, deckId: toDeckId, updatedAt: new Date().toISOString() };
  const { id, deckId, ...rest } = moved;
  const version = reviewVersionOf(card);
  const storedVersion =
    version === undefined ? {} : { reviewVersion: (version ?? 0) + 1 };
  const deleteCondition =
    version === undefined
      ? {}
      : version === null
        ? {
            ConditionExpression:
              "attribute_exists(#pk) AND attribute_not_exists(#reviewVersion)",
            ExpressionAttributeNames: { "#pk": "PK", "#reviewVersion": "reviewVersion" },
          }
        : {
            ConditionExpression: "attribute_exists(#pk) AND #reviewVersion = :reviewVersion",
            ExpressionAttributeNames: { "#pk": "PK", "#reviewVersion": "reviewVersion" },
            ExpressionAttributeValues: { ":reviewVersion": version },
          };
  await db.send(
    new TransactWriteCommand({
      TransactItems: [
        activeDeckCheck(card.deckId),
        activeDeckCheck(toDeckId),
        {
          Delete: {
            TableName: tableName(),
            Key: cardKey(card.deckId, card.id),
            ...deleteCondition,
          },
        },
        {
          Put: {
            TableName: tableName(),
            Item: { ...cardKey(deckId, id), ...rest, ...storedVersion },
            ConditionExpression: "attribute_not_exists(#pk)",
            ExpressionAttributeNames: { "#pk": "PK" },
          },
        },
      ],
    })
  );
  return moved;
}

/**
 * Lock a deck against new card writes, strongly sweep its cards, then remove
 * the deck record. Writers check the same lock in their transactions.
 */
export async function deleteDeck(id: string, session?: AuthSession): Promise<void> {
  const scope = await resolveScope(session);
  if (scope.mode === "multi") {
    const deck = await getDeck(id, scope.user);
    if (!deck) return;
    assertCanMutateContent(scope, deck.source ?? "global");
    const key = contentDeckKey(scope, deck);
    await db.send(
      new UpdateCommand({
        TableName: tableName(),
        Key: key,
        UpdateExpression: "SET #archivedAt = if_not_exists(#archivedAt, :now)",
        ExpressionAttributeNames: { "#archivedAt": "archivedAt" },
        ExpressionAttributeValues: { ":now": new Date().toISOString() },
      })
    );
    return;
  }
  try {
    await db.send(
      new UpdateCommand({
        TableName: tableName(),
        Key: deckKey(id),
        UpdateExpression: "SET #deletingAt = if_not_exists(#deletingAt, :now)",
        ConditionExpression: "attribute_exists(#pk)",
        ExpressionAttributeNames: { "#pk": "PK", "#deletingAt": "deletingAt" },
        ExpressionAttributeValues: { ":now": new Date().toISOString() },
      })
    );
  } catch (error) {
    if (error instanceof Error && error.name === "ConditionalCheckFailedException") return;
    throw error;
  }

  const cards = await listCards(id, { consistent: true });
  await batchWrite(
    cards.map((card) => ({ DeleteRequest: { Key: cardKey(card.deckId, card.id) } }))
  );
  try {
    await db.send(
      new DeleteCommand({
        TableName: tableName(),
        Key: deckKey(id),
        ConditionExpression: "attribute_exists(#deletingAt)",
        ExpressionAttributeNames: { "#deletingAt": "deletingAt" },
      })
    );
  } catch (error) {
    if (error instanceof Error && error.name === "ConditionalCheckFailedException") return;
    throw error;
  }
}

function reviewLogFields(cardId: string, log: ReviewLog): Item {
  const appliedAt = new Date(log.review).toISOString();
  return {
    cardId,
    rating: log.rating,
    state: log.state,
    reviewedAt: appliedAt,
    appliedAt,
    due: new Date(log.due).toISOString(),
    stability: log.stability,
    difficulty: log.difficulty,
    elapsed_days: log.elapsed_days,
    scheduled_days: log.scheduled_days,
  };
}

let reviewStatsInitialization: Promise<void> | null = null;

async function initializeReviewStats(): Promise<void> {
  const existing = await db.send(
    new GetCommand({
      TableName: tableName(),
      Key: reviewStatsKey,
      ConsistentRead: true,
    })
  );
  if (typeof existing.Item?.reviewCount === "number") return;

  let count = 0;
  let startKey: Item | undefined;
  do {
    const res = await db.send(
      new QueryCommand({
        TableName: tableName(),
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: { ":pk": "LOGS" },
        Select: "COUNT",
        ConsistentRead: true,
        ExclusiveStartKey: startKey,
      })
    );
    count += res.Count ?? 0;
    startKey = res.LastEvaluatedKey;
  } while (startKey);

  // Multiple server instances may race this one-time backfill. if_not_exists
  // makes exactly one observed count authoritative without replacing any other
  // fields on the shared stats item.
  await db.send(
    new UpdateCommand({
      TableName: tableName(),
      Key: reviewStatsKey,
      UpdateExpression:
        "SET #reviewCount = if_not_exists(#reviewCount, :count), " +
        "#reviewCountVersion = if_not_exists(#reviewCountVersion, :version)",
      ExpressionAttributeNames: {
        "#reviewCount": "reviewCount",
        "#reviewCountVersion": "reviewCountVersion",
      },
      ExpressionAttributeValues: { ":count": count, ":version": 1 },
    })
  );
}

async function ensureReviewStats(): Promise<void> {
  reviewStatsInitialization ??= initializeReviewStats().catch((error) => {
    reviewStatsInitialization = null;
    throw error;
  });
  await reviewStatsInitialization;
}

export type ReviewReceipt = {
  mode?: ReviewMode;
  source?: CardSource;
  clientReviewId: string;
  cardId: string;
  deckId: string;
  rating: number;
  reviewedAt: string;
};

export type PendingReviewWrite = ReviewReceipt & {
  card: Card;
  expectedVersion: number | null;
  log: ReviewLog;
  session?: AuthSession;
};

export type ReviewWriteResult =
  | { status: "committed" }
  | { status: "duplicate"; receipt: ReviewReceipt }
  | { status: "mismatch"; receipt: ReviewReceipt }
  | { status: "conflict" };

function toReviewReceipt(item: Item | undefined): ReviewReceipt | null {
  if (
    !item ||
    typeof item.clientReviewId !== "string" ||
    typeof item.cardId !== "string" ||
    typeof item.deckId !== "string" ||
    typeof item.rating !== "number" ||
    typeof item.reviewedAt !== "string"
  ) {
    return null;
  }
  return {
    clientReviewId: item.clientReviewId,
    cardId: item.cardId,
    deckId: item.deckId,
    rating: item.rating,
    reviewedAt: item.reviewedAt,
    mode: (item.mode as ReviewMode) ?? "review",
    source: item.source as CardSource | undefined,
  };
}

export function reviewReceiptsMatch(a: ReviewReceipt, b: ReviewReceipt): boolean {
  return (
    a.clientReviewId === b.clientReviewId &&
    a.cardId === b.cardId &&
    a.deckId === b.deckId &&
    (!a.source || !b.source || a.source === b.source) &&
    (a.mode ?? "review") === (b.mode ?? "review") &&
    a.rating === b.rating &&
    a.reviewedAt === b.reviewedAt
  );
}

export async function getReviewReceipt(
  clientReviewId: string,
  session?: AuthSession
): Promise<ReviewReceipt | null> {
  const scope = await resolveScope(session);
  if (scope.mode === "multi") {
    const res = await observeDbLatency("review.receipt.get", () =>
      db.send(
        new GetCommand({
          TableName: tableName(),
          Key: userReviewReceiptKey(scope.user.userId, clientReviewId),
          ConsistentRead: true,
        })
      )
    );
    return toReviewReceipt(res.Item);
  }
  const res = await observeDbLatency("review.receipt.get", () =>
    db.send(
      new GetCommand({
        TableName: tableName(),
        Key: reviewReceiptKey(clientReviewId),
        ConsistentRead: true,
      })
    )
  );
  return toReviewReceipt(res.Item);
}

export async function getCardForReview(
  deckId: string,
  cardId: string,
  session?: AuthSession
): Promise<{ card: Card; version: number | null } | null> {
  const card = await getCard(deckId, cardId, session);
  if (!card) return null;
  return { card, version: reviewVersionOf(card) ?? null };
}

/**
 * Advances a card, records the review/idempotency receipt, and increments the
 * aggregate count in one DynamoDB transaction. A legacy card without a version
 * participates with attribute_not_exists and is upgraded on its first review.
 */
export async function commitReview(
  review: PendingReviewWrite
): Promise<ReviewWriteResult> {
  const scope = await resolveScope(review.session);
  if (review.card.id !== review.cardId || review.card.deckId !== review.deckId) {
    throw new Error("Review card identity does not match the request");
  }
  if (scope.mode === "multi") {
    const source = review.card.source ?? review.source ?? "private";
    if (scope.user.isAdmin) throw new Error("Admin accounts cannot commit reviews");
    const nextVersion = (review.expectedVersion ?? 0) + 1;
    const versionCondition =
      review.expectedVersion === null
        ? "attribute_not_exists(#reviewVersion)"
        : "#reviewVersion = :expectedVersion";
    const versionValues =
      review.expectedVersion === null
        ? undefined
        : { ":expectedVersion": review.expectedVersion };
    const receipt: ReviewReceipt = {
      clientReviewId: review.clientReviewId,
      cardId: review.cardId,
      deckId: review.deckId,
      source,
      rating: review.rating,
      reviewedAt: review.reviewedAt,
      mode: review.mode ?? "review",
    };
    try {
      await observeDbLatency("review.commit", () =>
        db.send(
          new TransactWriteCommand({
            TransactItems: [
              {
                Put: {
                  TableName: tableName(),
                  Item: {
                    ...progressKey(scope.user.userId, source, review.deckId, review.cardId),
                    ...progressFieldsFromCard({ ...review.card, source }),
                    updatedAt: review.reviewedAt,
                    reviewVersion: nextVersion,
                  },
                  ConditionExpression: versionCondition,
                  ExpressionAttributeNames: { "#reviewVersion": "reviewVersion" },
                  ...(versionValues ? { ExpressionAttributeValues: versionValues } : {}),
                },
              },
              {
                Put: {
                  TableName: tableName(),
                  Item: {
                    ...userReviewLogKey(
                      scope.user.userId,
                      new Date(review.log.review).toISOString(),
                      source,
                      review.deckId,
                      review.cardId,
                      review.clientReviewId
                    ),
                    ...reviewLogFields(review.cardId, review.log),
                    ...receipt,
                  },
                  ConditionExpression: "attribute_not_exists(#pk)",
                  ExpressionAttributeNames: { "#pk": "PK" },
                },
              },
              {
                Put: {
                  TableName: tableName(),
                  Item: { ...userReviewReceiptKey(scope.user.userId, review.clientReviewId), ...receipt },
                  ConditionExpression: "attribute_not_exists(#pk)",
                  ExpressionAttributeNames: { "#pk": "PK" },
                },
              },
              {
                Update: {
                  TableName: tableName(),
                  Key: userReviewStatsKey(scope.user.userId),
                  UpdateExpression:
                    "SET #updatedAt = :updatedAt, #lastReviewAt = :updatedAt ADD #reviewCount :one",
                  ExpressionAttributeNames: {
                    "#reviewCount": "reviewCount",
                    "#updatedAt": "updatedAt",
                    "#lastReviewAt": "lastReviewAt",
                  },
                  ExpressionAttributeValues: {
                    ":one": 1,
                    ":updatedAt": review.reviewedAt,
                  },
                },
              },
              activeContentDeckCheck(scope, { id: review.deckId, source }),
            ],
          })
        )
      );
      return { status: "committed" };
    } catch (error) {
      if (!(error instanceof Error) || error.name !== "TransactionCanceledException") {
        throw error;
      }
      const existing = await getReviewReceipt(review.clientReviewId, scope.user);
      if (existing) {
        return reviewReceiptsMatch(existing, receipt)
          ? { status: "duplicate", receipt: existing }
          : { status: "mismatch", receipt: existing };
      }
      return { status: "conflict" };
    }
  }
  await ensureReviewStats();
  const { id, deckId, ...cardFields } = review.card;
  const nextVersion = (review.expectedVersion ?? 0) + 1;
  const versionCondition =
    review.expectedVersion === null
      ? "attribute_not_exists(#reviewVersion)"
      : "#reviewVersion = :expectedVersion";
  const cardExpressionValues: Record<string, unknown> = {};
  if (review.expectedVersion !== null) {
    cardExpressionValues[":expectedVersion"] = review.expectedVersion;
  }
  const receipt: ReviewReceipt = {
    clientReviewId: review.clientReviewId,
    cardId: review.cardId,
    deckId: review.deckId,
    rating: review.rating,
    reviewedAt: review.reviewedAt,
    mode: review.mode ?? "review",
  };

  try {
    await observeDbLatency("review.commit", () =>
      db.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: tableName(),
                Item: {
                  ...cardKey(deckId, id),
                  ...cardFields,
                  reviewVersion: nextVersion,
                },
                ConditionExpression:
                  `attribute_exists(#pk) AND attribute_exists(#sk) AND ${versionCondition}`,
                ExpressionAttributeNames: {
                  "#pk": "PK",
                  "#sk": "SK",
                  "#reviewVersion": "reviewVersion",
                },
                ...(
                  Object.keys(cardExpressionValues).length > 0
                    ? { ExpressionAttributeValues: cardExpressionValues }
                    : {}
                ),
              },
            },
            {
              Put: {
                TableName: tableName(),
                Item: {
                  ...reviewLogKey(
                    new Date(review.log.review).toISOString(),
                    review.cardId,
                    review.clientReviewId
                  ),
                  ...reviewLogFields(review.cardId, review.log),
                  ...receipt,
                },
                ConditionExpression: "attribute_not_exists(#pk)",
                ExpressionAttributeNames: { "#pk": "PK" },
              },
            },
            {
              Put: {
                TableName: tableName(),
                Item: { ...reviewReceiptKey(review.clientReviewId), ...receipt },
                ConditionExpression: "attribute_not_exists(#pk)",
                ExpressionAttributeNames: { "#pk": "PK" },
              },
            },
            {
              Update: {
                TableName: tableName(),
                Key: reviewStatsKey,
                UpdateExpression:
                  "SET #updatedAt = :updatedAt ADD #reviewCount :one",
                ConditionExpression: "attribute_exists(#reviewCount)",
                ExpressionAttributeNames: {
                  "#reviewCount": "reviewCount",
                  "#updatedAt": "updatedAt",
                },
                ExpressionAttributeValues: {
                  ":one": 1,
                  ":updatedAt": review.reviewedAt,
                },
              },
            },
            activeDeckCheck(review.deckId),
          ],
        })
      )
    );
    return { status: "committed" };
  } catch (error) {
    if (!(error instanceof Error) || error.name !== "TransactionCanceledException") {
      throw error;
    }

    // A committed transaction whose HTTP response was lost lands here on the
    // retry. The strongly consistent receipt turns it into a successful no-op.
    const existing = await getReviewReceipt(review.clientReviewId);
    if (existing) {
      return reviewReceiptsMatch(existing, receipt)
        ? { status: "duplicate", receipt: existing }
        : { status: "mismatch", receipt: existing };
    }
    // With no receipt, the card version lost an optimistic race. The route can
    // re-read the canonical card and recompute FSRS safely.
    return { status: "conflict" };
  }
}

export async function countReviewLogs(session?: AuthSession): Promise<number> {
  const scope = await resolveScope(session);
  if (scope.mode === "multi") {
    const res = await observeDbLatency("review.count.get", () =>
      db.send(
        new GetCommand({
          TableName: tableName(),
          Key: userReviewStatsKey(scope.user.userId),
          ConsistentRead: true,
        })
      )
    );
    return typeof res.Item?.reviewCount === "number" ? res.Item.reviewCount : 0;
  }
  await ensureReviewStats();
  const res = await observeDbLatency("review.count.get", () =>
    db.send(
      new GetCommand({
        TableName: tableName(),
        Key: reviewStatsKey,
        ConsistentRead: true,
      })
    )
  );
  return typeof res.Item?.reviewCount === "number" ? res.Item.reviewCount : 0;
}

/** A marker update participates in the review lock, preserving concurrent reviews. */
export async function setCardHard(deckId: string, id: string, hard: boolean, session?: AuthSession) {
  const scope = await resolveScope(session);
  if (scope.mode === "multi") {
    if (scope.user.isAdmin) {
      throw new ContentAccessError("Admin accounts cannot mark cards hard");
    }
    const card = await getCard(deckId, id, scope.user);
    if (!card) return;
    const source = card.source ?? "private";
    const existingVersion = reviewVersionOf(card);
    await db.send(new UpdateCommand({
      TableName: tableName(),
      Key: progressKey(scope.user.userId, source, deckId, id),
      UpdateExpression:
        "SET #source = :source, #deckId = :deckId, #cardId = :cardId, #fsrs = if_not_exists(#fsrs, :fsrs), #hard = :hard, #updatedAt = :updatedAt ADD #version :one",
      ExpressionAttributeNames: {
        "#source": "source",
        "#deckId": "deckId",
        "#cardId": "cardId",
        "#fsrs": "fsrs",
        "#hard": "hard",
        "#updatedAt": "updatedAt",
        "#version": "reviewVersion",
      },
      ExpressionAttributeValues: {
        ":source": source,
        ":deckId": deckId,
        ":cardId": id,
        ":fsrs": card.fsrs,
        ":hard": hard,
        ":updatedAt": new Date().toISOString(),
        ":one": 1,
        ...(existingVersion !== null ? { ":expectedVersion": existingVersion } : {}),
      },
      ...(existingVersion !== null
        ? { ConditionExpression: "#version = :expectedVersion" }
        : {}),
    }));
    return;
  }
  await db.send(new UpdateCommand({
    TableName: tableName(), Key: cardKey(deckId, id),
    UpdateExpression: "SET #hard = :hard ADD #version :one",
    ConditionExpression: "attribute_exists(PK)",
    ExpressionAttributeNames: { "#hard": "hard", "#version": "reviewVersion" },
    ExpressionAttributeValues: { ":hard": hard, ":one": 1 },
  }));
}

export async function hideGlobalDeck(deckId: string, session?: AuthSession): Promise<void> {
  const scope = await resolveScope(session);
  if (scope.mode === "legacy") return;
  if (scope.user.isAdmin) throw new ContentAccessError("Admin accounts cannot hide study content");
  await db.send(
    new PutCommand({
      TableName: tableName(),
      Item: { ...hiddenDeckKey(scope.user.userId, deckId), hiddenAt: new Date().toISOString() },
    })
  );
}

export async function unhideGlobalDeck(deckId: string, session?: AuthSession): Promise<void> {
  const scope = await resolveScope(session);
  if (scope.mode === "legacy") return;
  if (scope.user.isAdmin) throw new ContentAccessError("Admin accounts cannot hide study content");
  await db.send(new DeleteCommand({ TableName: tableName(), Key: hiddenDeckKey(scope.user.userId, deckId) }));
}

export async function hideGlobalCard(deckId: string, cardId: string, session?: AuthSession): Promise<void> {
  const scope = await resolveScope(session);
  if (scope.mode === "legacy") return;
  if (scope.user.isAdmin) throw new ContentAccessError("Admin accounts cannot hide study content");
  await db.send(
    new PutCommand({
      TableName: tableName(),
      Item: { ...hiddenCardKey(scope.user.userId, deckId, cardId), hiddenAt: new Date().toISOString() },
    })
  );
}

export async function unhideGlobalCard(deckId: string, cardId: string, session?: AuthSession): Promise<void> {
  const scope = await resolveScope(session);
  if (scope.mode === "legacy") return;
  if (scope.user.isAdmin) throw new ContentAccessError("Admin accounts cannot hide study content");
  await db.send(new DeleteCommand({ TableName: tableName(), Key: hiddenCardKey(scope.user.userId, deckId, cardId) }));
}
