import { syncCharacterIndexes } from "./character-index";
import { currentRetentionSchedule } from "./fsrs";
import {
  QueryCommand,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  BatchWriteCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { usesMultiUserData } from "./flags";
import type { ReleaseTeaser } from "./multi-user-model";
import type { Card, Deck, ReviewMode } from "./types";
import type { ReviewLog } from "ts-fsrs";
import { getDocClient, observeDbLatency, tableName } from "./dynamo";

async function multiUserStore() {
  return import("./multi-user-store");
}

const db = getDocClient();

type Item = Record<string, unknown>;

const deckKey = (id: string) => ({ PK: "DECKS", SK: `DECK#${id}` });
const cardKey = (deckId: string, id: string) => ({
  PK: `DECK#${deckId}`,
  SK: `CARD#${id}`,
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

// Keep optimistic-lock metadata outside the public card object. Even a
// non-enumerable symbol causes React Server Component serialization warnings.
const cardReviewVersions = new WeakMap<Card, number | null>();

function toDeck(item: Item): Deck {
  const { PK, SK, deletingAt, ...rest } = item;
  void PK;
  void deletingAt;
  return { ...(rest as Omit<Deck, "id">), id: (SK as string).slice("DECK#".length) };
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

function reviewVersionOf(card: Card): number | null | undefined {
  return cardReviewVersions.get(card);
}

export async function listDecks(): Promise<Deck[]> {
  if (usesMultiUserData()) return (await multiUserStore()).listDecksForCurrentUser();
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

/** Next global release for a learner. Metadata only — no card text. */
export async function nextReleaseTeaser(): Promise<ReleaseTeaser | null> {
  if (!usesMultiUserData()) return null;
  return (await multiUserStore()).nextReleaseTeaserForCurrentUser();
}

export async function getDeck(id: string): Promise<Deck | null> {
  if (usesMultiUserData()) return (await multiUserStore()).getDeckForCurrentUser(id);
  const res = await db.send(
    new GetCommand({ TableName: tableName(), Key: deckKey(id), ConsistentRead: true })
  );
  return res.Item && typeof res.Item.deletingAt !== "string" ? toDeck(res.Item) : null;
}

export async function putDeck(
  deck: Deck,
  options: { create?: boolean } = {}
): Promise<void> {
  if (usesMultiUserData()) return (await multiUserStore()).putDeckForCurrentUser(deck, options);
  const { id, ...rest } = deck;
  await db.send(
    new PutCommand({
      TableName: tableName(),
      Item: { ...deckKey(id), ...rest },
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
  options: { consistent?: boolean } = {}
): Promise<Card[]> {
  if (usesMultiUserData()) return (await multiUserStore()).listCardsForCurrentUser(deckId, options);
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
  options: { consistent?: boolean } = {}
): Promise<Card[]> {
  if (usesMultiUserData()) return (await multiUserStore()).listAllCardsForCurrentUser(decks, options);
  const sourceDecks = decks ?? (await listDecks());
  const cardsByDeck: Card[][] = new Array(sourceDecks.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < sourceDecks.length) {
      const index = nextIndex++;
      cardsByDeck[index] = await listCards(sourceDecks[index].id, options);
    }
  }

  // Each deck is its own partition. Eight in flight overlaps round trips on
  // home, browse, and stats without bursting a large collection all at once.
  const workerCount = Math.min(8, sourceDecks.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return cardsByDeck.flat();
}

export async function getCard(deckId: string, id: string): Promise<Card | null> {
  if (usesMultiUserData()) return (await multiUserStore()).getCardForCurrentUser(deckId, id);
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

export async function putCard(
  card: Card,
  options?: { previous?: Pick<Card, "front" | "back"> }
): Promise<void> {
  if (usesMultiUserData()) return (await multiUserStore()).putCardForCurrentUser(card);
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
  await syncCharacterIndexes({ kind: "legacy" }, [
    {
      deckId,
      cardId: id,
      front: card.front,
      back: card.back,
      updatedAt: card.updatedAt,
      previousFront: options?.previous?.front ?? card.front,
      previousBack: options?.previous?.back ?? card.back,
    },
  ]);
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
      await syncCharacterIndexes(
        { kind: "legacy" },
        pending.map((card) => ({
          deckId: card.deckId,
          cardId: card.id,
          front: card.front,
          back: card.back,
          updatedAt: card.updatedAt,
        }))
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
      await syncCharacterIndexes(
        { kind: "legacy" },
        existing.flatMap((res, index) => {
          const item = res.Item;
          if (!item || typeof item.front !== "string" || typeof item.back !== "string") return [];
          return [
            {
              deckId: pending[index].deckId,
              cardId: pending[index].id,
              front: item.front,
              back: item.back,
              updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : pending[index].updatedAt,
            },
          ];
        })
      );
      pending = pending.filter((_, index) => !existing[index].Item);
    }
  }
  if (pending.length > 0) {
    throw new Error("DynamoDB card creation did not complete");
  }
}

/** Create cards without replacing existing records; imports may skip stable IDs on retry. */
export async function batchPutCards(
  cards: Card[],
  options: { skipExisting?: boolean } = {}
): Promise<void> {
  if (usesMultiUserData()) return (await multiUserStore()).batchPutCardsForCurrentUser(cards, options);
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

export async function deleteCard(deckId: string, id: string): Promise<void> {
  if (usesMultiUserData()) return (await multiUserStore()).deleteCardForCurrentUser(deckId, id);
  const existing = await getCard(deckId, id);
  await db.send(
    new DeleteCommand({ TableName: tableName(), Key: cardKey(deckId, id) })
  );
  if (!existing) return;
  await syncCharacterIndexes({ kind: "legacy" }, [
    {
      deckId,
      cardId: id,
      front: "",
      back: "",
      updatedAt: existing.updatedAt,
      previousFront: existing.front,
      previousBack: existing.back,
    },
  ]);
}

/** Move = PK change, so transactionally delete + put keeping id and FSRS state. */
export async function moveCard(card: Card, toDeckId: string): Promise<Card> {
  if (usesMultiUserData()) return (await multiUserStore()).moveCardForCurrentUser(card, toDeckId);
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
  await syncCharacterIndexes({ kind: "legacy" }, [
    {
      deckId: moved.deckId,
      cardId: moved.id,
      front: moved.front,
      back: moved.back,
      updatedAt: moved.updatedAt,
      previousFront: card.front,
      previousBack: card.back,
    },
  ]);
  return moved;
}

/**
 * Lock a deck against new card writes, strongly sweep its cards, then remove
 * the deck record. Writers check the same lock in their transactions.
 */
export async function deleteDeck(id: string): Promise<void> {
  if (usesMultiUserData()) return (await multiUserStore()).deleteDeckForCurrentUser(id);
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
  await syncCharacterIndexes(
    { kind: "legacy" },
    cards.map((card) => ({
      deckId: card.deckId,
      cardId: card.id,
      front: "",
      back: "",
      updatedAt: card.updatedAt,
      previousFront: card.front,
      previousBack: card.back,
    }))
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
};

export type ReviewWriteResult =
  | { status: "committed" }
  | { status: "duplicate"; receipt: ReviewReceipt }
  | { status: "mismatch"; receipt: ReviewReceipt }
  | { status: "conflict" }
  | { status: "unavailable" };

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
  };
}

export function reviewReceiptsMatch(a: ReviewReceipt, b: ReviewReceipt): boolean {
  return (
    a.clientReviewId === b.clientReviewId &&
    a.cardId === b.cardId &&
    a.deckId === b.deckId &&
    (a.mode ?? "review") === (b.mode ?? "review") &&
    a.rating === b.rating &&
    a.reviewedAt === b.reviewedAt
  );
}

export async function getReviewReceipt(
  clientReviewId: string
): Promise<ReviewReceipt | null> {
  if (usesMultiUserData()) return (await multiUserStore()).getReviewReceiptForCurrentUser(clientReviewId);
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
  cardId: string
): Promise<{ card: Card; version: number | null } | null> {
  if (usesMultiUserData()) return (await multiUserStore()).getCardForReviewForCurrentUser(deckId, cardId);
  const card = await getCard(deckId, cardId);
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
  if (usesMultiUserData()) return (await multiUserStore()).commitReviewForCurrentUser(review);
  if (review.card.id !== review.cardId || review.card.deckId !== review.deckId) {
    throw new Error("Review card identity does not match the request");
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

export async function countReviewLogs(): Promise<number> {
  if (usesMultiUserData()) return (await multiUserStore()).countReviewLogsForCurrentUser();
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
export async function setCardHard(deckId: string, id: string, hard: boolean) {
  if (usesMultiUserData()) return (await multiUserStore()).setCardHardForCurrentUser(deckId, id, hard);
  await db.send(new UpdateCommand({
    TableName: tableName(), Key: cardKey(deckId, id),
    UpdateExpression: "SET #hard = :hard ADD #version :one",
    ConditionExpression: "attribute_exists(PK)",
    ExpressionAttributeNames: { "#hard": "hard", "#version": "reviewVersion" },
    ExpressionAttributeValues: { ":hard": hard, ":one": 1 },
  }));
}
