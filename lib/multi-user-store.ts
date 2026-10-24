import { randomUUID } from "node:crypto";
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type { ReviewLog } from "ts-fsrs";
import { AccessError } from "./access-error";
import { getAppSession } from "./app-session";
import { doc, tableName } from "./dynamo";
import { emptyCardState } from "./fsrs";
import { appTimeZone, localDateKey } from "./forecast";
import {
  deckFromItem,
  effectiveCard,
  globalCardKey,
  globalDeckKey,
  hiddenCardKey,
  hiddenPrefix,
  isReleasedToLearners,
  isStudied,
  nextScheduledTeaser,
  nextStudyStreak,
  planGlobalEdit,
  studiedOnFromSummary,
  visibleStreak,
  privateCardKey,
  privateDeckKey,
  progressKey,
  progressPrefix,
  releaseWeekLabel,
  toAdminUserSummary,
  userDirectoryKey,
  userLogsKey,
  userProfileKey,
  userReceiptsKey,
  userStatsKey,
  type ContentRecord,
  type ProgressRecord,
} from "./multi-user-model";
import type { AppSession } from "./principal";
import type { Card, Deck, ReviewMode } from "./types";

type ReviewReceipt = {
  mode?: ReviewMode;
  clientReviewId: string;
  cardId: string;
  deckId: string;
  rating: number;
  reviewedAt: string;
};

type PendingReviewWrite = ReviewReceipt & {
  card: Card;
  expectedVersion: number | null;
  log: ReviewLog;
};

type ReviewWriteResult =
  | { status: "committed" }
  | { status: "duplicate"; receipt: ReviewReceipt }
  | { status: "mismatch"; receipt: ReviewReceipt }
  | { status: "conflict" }
  | { status: "unavailable" };

type Item = Record<string, unknown>;

async function sessionOrThrow(): Promise<AppSession> {
  const session = await getAppSession();
  if (!session) throw new AccessError(401, "unauthorized");
  return session;
}

function assertLearner(session: AppSession): void {
  if (session.role === "admin") throw new AccessError(403, "admin accounts cannot study");
}

async function queryItems(pk: string, skPrefix?: string, consistent?: boolean): Promise<Item[]> {
  const items: Item[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const res = await doc.send(
      new QueryCommand({
        TableName: tableName(),
        KeyConditionExpression: skPrefix ? "PK = :pk AND begins_with(SK, :sk)" : "PK = :pk",
        ExpressionAttributeValues: skPrefix ? { ":pk": pk, ":sk": skPrefix } : { ":pk": pk },
        ConsistentRead: consistent || undefined,
        ExclusiveStartKey: startKey as never,
      })
    );
    items.push(...((res.Items ?? []) as Item[]));
    startKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (startKey);
  return items;
}

async function getItem(key: { PK: string; SK: string }): Promise<Item | null> {
  const res = await doc.send(
    new GetCommand({ TableName: tableName(), Key: key, ConsistentRead: true })
  );
  return (res.Item as Item | undefined) ?? null;
}

function contentFromItem(item: Item, deckId: string, source: "global" | "private"): ContentRecord | null {
  if (typeof item.SK !== "string" || !item.SK.startsWith("CARD#")) return null;
  if (typeof item.front !== "string" || typeof item.back !== "string") return null;
  return {
    deckId,
    cardId: item.SK.slice("CARD#".length),
    front: item.front,
    back: item.back,
    createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date(0).toISOString(),
    updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : new Date(0).toISOString(),
    source,
    ...(typeof item.notes === "string" && item.notes ? { notes: item.notes } : {}),
    ...(typeof item.contentVersion === "number" ? { contentVersion: item.contentVersion } : {}),
    ...(typeof item.archivedAt === "string" ? { archivedAt: item.archivedAt } : {}),
  };
}

function progressFromItem(item: Item): ProgressRecord {
  return {
    ...(item.fsrs && typeof item.fsrs === "object" ? { fsrs: item.fsrs as ProgressRecord["fsrs"] } : {}),
    ...(item.modes && typeof item.modes === "object" ? { modes: item.modes as ProgressRecord["modes"] } : {}),
    ...(item.practice && typeof item.practice === "object"
      ? { practice: item.practice as ProgressRecord["practice"] }
      : {}),
    ...(item.hard === true ? { hard: true } : {}),
    ...(typeof item.reviewVersion === "number" ? { reviewVersion: item.reviewVersion } : {}),
    ...(typeof item.updatedAt === "string" ? { updatedAt: item.updatedAt } : {}),
  };
}

async function loadDeck(session: AppSession, id: string): Promise<Deck | null> {
  const globalItem = await getItem(globalDeckKey(id));
  if (globalItem && typeof globalItem.archivedAt !== "string") {
    const deck = deckFromItem(globalItem, id, "global");
    if (session.role === "admin" || isReleasedToLearners(deck, new Date())) return deck;
  }
  if (session.role === "admin") return null;
  const privateItem = await getItem(privateDeckKey(session.userId, id));
  if (!privateItem || typeof privateItem.archivedAt === "string") return null;
  return deckFromItem(privateItem, id, "private");
}

function visible(deck: Deck, session: AppSession, now = new Date()): boolean {
  if (deck.archivedAt) return false;
  if (session.role === "admin") return deck.source !== "private";
  return isReleasedToLearners(deck, now);
}

export async function listDecksForCurrentUser(): Promise<Deck[]> {
  const session = await sessionOrThrow();
  const now = new Date();
  const globalItems = await queryItems("GLOBAL#DECKS");
  const decks = globalItems
    .filter((item) => typeof item.SK === "string" && item.SK.startsWith("DECK#"))
    .map((item) => deckFromItem(item, String(item.SK).slice("DECK#".length), "global"))
    .filter((deck) => visible(deck, session, now));
  if (session.role !== "admin") {
    const privateItems = await queryItems(`USER#${session.userId}#DECKS`);
    for (const item of privateItems) {
      if (typeof item.SK !== "string" || !item.SK.startsWith("DECK#")) continue;
      const deck = deckFromItem(item, item.SK.slice("DECK#".length), "private");
      if (visible(deck, session, now)) decks.push(deck);
    }
  }
  return decks.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getDeckForCurrentUser(id: string): Promise<Deck | null> {
  const session = await sessionOrThrow();
  return loadDeck(session, id);
}

export async function putDeckForCurrentUser(deck: Deck, options: { create?: boolean } = {}): Promise<void> {
  const session = await sessionOrThrow();
  if (options.create) {
    if (session.role === "admin") {
      await doc.send(
        new PutCommand({
          TableName: tableName(),
          Item: {
            ...globalDeckKey(deck.id),
            name: deck.name,
            createdAt: deck.createdAt,
            updatedAt: deck.updatedAt,
            source: "global",
            status: "draft",
            ...(deck.frontLanguage ? { frontLanguage: deck.frontLanguage } : {}),
            ...(deck.backLanguage ? { backLanguage: deck.backLanguage } : {}),
            ...(deck.chineseSide ? { chineseSide: deck.chineseSide } : {}),
          },
          ConditionExpression: "attribute_not_exists(PK)",
        })
      );
      return;
    }
    assertLearner(session);
    await doc.send(
      new PutCommand({
        TableName: tableName(),
        Item: {
          ...privateDeckKey(session.userId, deck.id),
          name: deck.name,
          createdAt: deck.createdAt,
          updatedAt: deck.updatedAt,
          source: "private",
          ownerUserId: session.userId,
          ...(deck.frontLanguage ? { frontLanguage: deck.frontLanguage } : {}),
          ...(deck.backLanguage ? { backLanguage: deck.backLanguage } : {}),
          ...(deck.chineseSide ? { chineseSide: deck.chineseSide } : {}),
        },
        ConditionExpression: "attribute_not_exists(PK)",
      })
    );
    return;
  }

  const existing = await loadDeck(session, deck.id);
  if (!existing) throw new AccessError(404, "deck not found");
  if (existing.source === "global" && session.role !== "admin") {
    throw new AccessError(403, "admin only");
  }
  if (existing.source === "private") assertLearner(session);
  const key = existing.source === "global" ? globalDeckKey(deck.id) : privateDeckKey(session.userId, deck.id);
  await doc.send(
    new UpdateCommand({
      TableName: tableName(),
      Key: key,
      UpdateExpression:
        "SET #name = :name, updatedAt = :updatedAt, frontLanguage = :frontLanguage, backLanguage = :backLanguage, chineseSide = :chineseSide",
      ConditionExpression: "attribute_exists(PK) AND attribute_not_exists(archivedAt)",
      ExpressionAttributeNames: { "#name": "name" },
      ExpressionAttributeValues: {
        ":name": deck.name,
        ":updatedAt": deck.updatedAt,
        ":frontLanguage": deck.frontLanguage ?? null,
        ":backLanguage": deck.backLanguage ?? null,
        ":chineseSide": deck.chineseSide ?? null,
      },
    })
  );
}

async function cardsForDeck(session: AppSession, deck: Deck, consistent?: boolean): Promise<Card[]> {
  const released = session.role === "admin" ? !deck.archivedAt : isReleasedToLearners(deck, new Date());
  if (!released) return [];
  const contentPk = deck.source === "private"
    ? privateCardKey(session.userId, deck.id, "unused").PK
    : globalCardKey(deck.id, "unused").PK;
  const contentItems = await queryItems(contentPk, "CARD#", consistent);
  const hideProgress = session.role === "admin";
  const progressItems = hideProgress
    ? []
    : await queryItems(
        progressPrefix(session.userId, deck.source ?? "global", deck.id).PK,
        progressPrefix(session.userId, deck.source ?? "global", deck.id).SK,
        consistent
      );
  const hiddenItems = hideProgress
    ? []
    : await queryItems(
        hiddenPrefix(session.userId, deck.id).PK,
        hiddenPrefix(session.userId, deck.id).SK,
        consistent
      );
  const progressByCard = new Map<string, ProgressRecord>();
  for (const item of progressItems) {
    if (typeof item.SK !== "string") continue;
    const marker = "#CARD#";
    const index = item.SK.lastIndexOf(marker);
    if (index === -1) continue;
    progressByCard.set(item.SK.slice(index + marker.length), progressFromItem(item));
  }
  const hidden = new Set(
    hiddenItems
      .filter((item) => typeof item.SK === "string")
      .map((item) => String(item.SK).slice(hiddenPrefix(session.userId, deck.id).SK.length))
  );
  const cards: Card[] = [];
  for (const item of contentItems) {
    const content = contentFromItem(item, deck.id, deck.source ?? "global");
    if (!content) continue;
    const card = effectiveCard({
      content,
      progress: progressByCard.get(content.cardId) ?? null,
      hidden: hidden.has(content.cardId),
      released: true,
      hideProgress,
    });
    if (card) cards.push(card);
  }
  return cards;
}

export async function listCardsForCurrentUser(deckId: string, options: { consistent?: boolean } = {}): Promise<Card[]> {
  const session = await sessionOrThrow();
  const deck = await loadDeck(session, deckId);
  if (!deck) return [];
  return cardsForDeck(session, deck, options.consistent);
}

export async function listAllCardsForCurrentUser(
  decks?: readonly Pick<Deck, "id">[],
  options: { consistent?: boolean } = {}
): Promise<Card[]> {
  const session = await sessionOrThrow();
  const source = decks ?? (await listDecksForCurrentUser());
  const cards: Card[][] = [];
  for (const deck of source) {
    const full = await loadDeck(session, deck.id);
    if (!full) continue;
    cards.push(await cardsForDeck(session, full, options.consistent));
  }
  return cards.flat();
}

export async function getCardForCurrentUser(deckId: string, id: string): Promise<Card | null> {
  const cards = await listCardsForCurrentUser(deckId, { consistent: true });
  return cards.find((card) => card.id === id) ?? null;
}

export async function putCardForCurrentUser(card: Card): Promise<void> {
  const session = await sessionOrThrow();
  const deck = await loadDeck(session, card.deckId);
  if (!deck) throw new AccessError(404, "deck not found");
  if (deck.source === "global" && session.role !== "admin") throw new AccessError(403, "admin only");
  if (deck.source === "private") assertLearner(session);
  const key = deck.source === "private"
    ? privateCardKey(session.userId, card.deckId, card.id)
    : globalCardKey(card.deckId, card.id);
  const names: Record<string, string> = {
    "#front": "front",
    "#back": "back",
    "#updatedAt": "updatedAt",
    "#contentVersion": "contentVersion",
  };
  const values: Record<string, unknown> = {
    ":front": card.front,
    ":back": card.back,
    ":updatedAt": card.updatedAt,
    ":one": 1,
  };
  let update = "SET #front = :front, #back = :back, #updatedAt = :updatedAt, #contentVersion = if_not_exists(#contentVersion, :one) + :one";
  if (card.notes) {
    names["#notes"] = "notes";
    values[":notes"] = card.notes;
    update += ", #notes = :notes";
  } else {
    names["#notes"] = "notes";
    update += " REMOVE #notes";
  }
  await doc.send(
    new UpdateCommand({
      TableName: tableName(),
      Key: key,
      UpdateExpression: update,
      ConditionExpression: "attribute_exists(PK) AND attribute_not_exists(archivedAt)",
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    })
  );
}

function contentPut(card: Card, key: { PK: string; SK: string }, source: "global" | "private") {
  return {
    ...key,
    front: card.front,
    back: card.back,
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
    contentVersion: 1,
    source,
    ...(card.notes ? { notes: card.notes } : {}),
  };
}

export async function batchPutCardsForCurrentUser(
  cards: Card[],
  options: { skipExisting?: boolean } = {}
): Promise<void> {
  const session = await sessionOrThrow();
  const groups = new Map<string, Card[]>();
  for (const card of cards) {
    const group = groups.get(card.deckId) ?? [];
    group.push(card);
    groups.set(card.deckId, group);
  }
  for (const [deckId, group] of groups) {
    const deck = await loadDeck(session, deckId);
    if (!deck) {
      const unavailable = new Error("Deck is unavailable");
      unavailable.name = "DeckUnavailableError";
      throw unavailable;
    }
    if (deck.source === "global" && session.role !== "admin") throw new AccessError(403, "admin only");
    if (deck.source === "private") assertLearner(session);
    let pending = group;
    const keyFor = (card: Card) =>
      deck.source === "private"
        ? privateCardKey(session.userId, card.deckId, card.id)
        : globalCardKey(card.deckId, card.id);
    if (options.skipExisting) {
      const existing = await Promise.all(pending.map((card) => getItem(keyFor(card))));
      pending = pending.filter((_, index) => !existing[index]);
    }
    for (let index = 0; index < pending.length; index += 24) {
      const chunk = pending.slice(index, index + 24);
      const deckKey = deck.source === "private" ? privateDeckKey(session.userId, deck.id) : globalDeckKey(deck.id);
      await doc.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              ConditionCheck: {
                TableName: tableName(),
                Key: deckKey,
                ConditionExpression: "attribute_exists(PK) AND attribute_not_exists(archivedAt)",
              },
            },
            ...chunk.map((card) => ({
              Put: {
                TableName: tableName(),
                Item: contentPut(card, keyFor(card), deck.source ?? "global"),
                ConditionExpression: "attribute_not_exists(PK)",
              },
            })),
          ],
        })
      );
    }
  }
}

async function archiveKey(key: { PK: string; SK: string }): Promise<void> {
  const now = new Date().toISOString();
  try {
    await doc.send(
      new UpdateCommand({
        TableName: tableName(),
        Key: key,
        UpdateExpression: "SET archivedAt = :now, updatedAt = :now",
        ConditionExpression: "attribute_exists(PK) AND attribute_not_exists(archivedAt)",
        ExpressionAttributeValues: { ":now": now },
      })
    );
  } catch (error) {
    if (error instanceof Error && error.name === "ConditionalCheckFailedException") return;
    throw error;
  }
}

export async function deleteCardForCurrentUser(deckId: string, id: string): Promise<void> {
  const session = await sessionOrThrow();
  const deck = await loadDeck(session, deckId);
  if (!deck) return;
  if (deck.source === "global" && session.role !== "admin") throw new AccessError(403, "admin only");
  if (deck.source === "private") assertLearner(session);
  const key = deck.source === "private"
    ? privateCardKey(session.userId, deckId, id)
    : globalCardKey(deckId, id);
  await archiveKey(key);
}

export async function deleteDeckForCurrentUser(id: string): Promise<void> {
  const session = await sessionOrThrow();
  const deck = await loadDeck(session, id);
  if (!deck) return;
  if (deck.source === "global" && session.role !== "admin") throw new AccessError(403, "admin only");
  if (deck.source === "private") assertLearner(session);
  const key = deck.source === "private" ? privateDeckKey(session.userId, id) : globalDeckKey(id);
  await archiveKey(key);
}

export async function moveCardForCurrentUser(card: Card, toDeckId: string): Promise<Card> {
  const session = await sessionOrThrow();
  assertLearner(session);
  const from = await loadDeck(session, card.deckId);
  const to = await loadDeck(session, toDeckId);
  if (!from || !to) throw new AccessError(404, "deck not found");
  if (from.source !== "private" || to.source !== "private") {
    throw new AccessError(403, "Global cards stay in place. A meaning change creates a new card.");
  }
  const fromKey = privateCardKey(session.userId, card.deckId, card.id);
  const toKey = privateCardKey(session.userId, toDeckId, card.id);
  const progressFrom = progressKey(session.userId, "private", card.deckId, card.id);
  const progressTo = progressKey(session.userId, "private", toDeckId, card.id);
  const progress = await getItem(progressFrom);
  const moved: Card = { ...card, deckId: toDeckId, updatedAt: new Date().toISOString(), source: "private" };
  const transact = [
    {
      ConditionCheck: {
        TableName: tableName(),
        Key: privateDeckKey(session.userId, card.deckId),
        ConditionExpression: "attribute_exists(PK) AND attribute_not_exists(archivedAt)",
      },
    },
    {
      ConditionCheck: {
        TableName: tableName(),
        Key: privateDeckKey(session.userId, toDeckId),
        ConditionExpression: "attribute_exists(PK) AND attribute_not_exists(archivedAt)",
      },
    },
    {
      Delete: {
        TableName: tableName(),
        Key: fromKey,
        ConditionExpression: "attribute_exists(PK)",
      },
    },
    {
      Put: {
        TableName: tableName(),
        Item: contentPut(moved, toKey, "private"),
        ConditionExpression: "attribute_not_exists(PK)",
      },
    },
  ];
  if (progress) {
    const { PK, SK, ...rest } = progress;
    void PK;
    void SK;
    transact.push(
      {
        Delete: {
          TableName: tableName(),
          Key: progressFrom,
          ConditionExpression: "attribute_exists(PK)",
        },
      } as never,
      {
        Put: {
          TableName: tableName(),
          Item: { ...progressTo, ...rest, deckId: toDeckId, source: "private" },
          ConditionExpression: "attribute_not_exists(PK)",
        },
      } as never
    );
  }
  await doc.send(new TransactWriteCommand({ TransactItems: transact }));
  return moved;
}

export async function replaceGlobalCardMeaning(
  card: Card,
  next: { front: string; back: string; notes?: string }
): Promise<Card> {
  const session = await sessionOrThrow();
  if (session.role !== "admin") throw new AccessError(403, "admin only");
  const current = await getItem(globalCardKey(card.deckId, card.id));
  if (!current || typeof current.archivedAt === "string") throw new AccessError(404, "card not found");
  const now = new Date().toISOString();
  const newId = randomUUID();
  const plan = planGlobalEdit({
    editKind: "meaning",
    cardId: card.id,
    now,
    newId,
    contentVersion: typeof current.contentVersion === "number" ? current.contentVersion : 1,
  });
  if ("error" in plan) throw new AccessError(403, plan.error);
  const created: Card = {
    ...card,
    id: newId,
    front: next.front,
    back: next.back,
    notes: next.notes,
    createdAt: now,
    updatedAt: now,
    source: "global",
    contentVersion: 1,
    fsrs: emptyCardState(new Date(now)),
    hard: undefined,
    modes: undefined,
    practice: undefined,
  };
  await doc.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Update: {
            TableName: tableName(),
            Key: globalCardKey(card.deckId, card.id),
            UpdateExpression: "SET archivedAt = :now, updatedAt = :now",
            ConditionExpression: "attribute_exists(PK) AND attribute_not_exists(archivedAt)",
            ExpressionAttributeValues: { ":now": now },
          },
        },
        {
          Put: {
            TableName: tableName(),
            Item: contentPut(created, globalCardKey(card.deckId, newId), "global"),
            ConditionExpression: "attribute_not_exists(PK)",
          },
        },
      ],
    })
  );
  return created;
}

export async function scheduleDeckRelease(
  deckId: string,
  releaseWeek: number,
  releaseAt: string,
  options: { confirmHide?: boolean } = {}
): Promise<Deck> {
  const session = await sessionOrThrow();
  if (session.role !== "admin") throw new AccessError(403, "admin only");
  if (!Number.isInteger(releaseWeek) || releaseWeek < 1) {
    throw new AccessError(403, "release week must be a positive whole number");
  }
  if (!Number.isFinite(Date.parse(releaseAt))) throw new AccessError(403, "release date is invalid");
  const deck = await loadDeck(session, deckId);
  if (!deck || deck.source !== "global") throw new AccessError(404, "deck not found");
  if (isReleasedToLearners(deck, new Date()) && !options.confirmHide) {
    throw new AccessError(
      403,
      "This deck is already visible. Confirm before hiding it until a new date."
    );
  }
  const updatedAt = new Date().toISOString();
  await doc.send(
    new UpdateCommand({
      TableName: tableName(),
      Key: globalDeckKey(deckId),
      UpdateExpression:
        "SET #status = :status, releaseWeek = :week, releaseAt = :releaseAt, releaseLabel = :label, updatedAt = :updatedAt",
      ConditionExpression: "attribute_exists(PK) AND attribute_not_exists(archivedAt)",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":status": "scheduled",
        ":week": releaseWeek,
        ":releaseAt": new Date(releaseAt).toISOString(),
        ":label": releaseWeekLabel(releaseWeek),
        ":updatedAt": updatedAt,
      },
    })
  );
  return {
    ...deck,
    status: "scheduled",
    releaseWeek,
    releaseAt: new Date(releaseAt).toISOString(),
    updatedAt,
  };
}

export async function publishDeckNow(deckId: string): Promise<Deck> {
  const session = await sessionOrThrow();
  if (session.role !== "admin") throw new AccessError(403, "admin only");
  const deck = await loadDeck(session, deckId);
  if (!deck || deck.source !== "global") throw new AccessError(404, "deck not found");
  const now = new Date().toISOString();
  await doc.send(
    new UpdateCommand({
      TableName: tableName(),
      Key: globalDeckKey(deckId),
      UpdateExpression: "SET #status = :status, releaseAt = :now, updatedAt = :now",
      ConditionExpression: "attribute_exists(PK) AND attribute_not_exists(archivedAt)",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: { ":status": "published", ":now": now },
    })
  );
  return { ...deck, status: "published", releaseAt: now, updatedAt: now };
}

export async function setGlobalCardHidden(deckId: string, cardId: string, hidden: boolean): Promise<void> {
  const session = await sessionOrThrow();
  assertLearner(session);
  const deck = await loadDeck(session, deckId);
  if (!deck || deck.source !== "global") throw new AccessError(404, "card not found");
  const content = await getItem(globalCardKey(deckId, cardId));
  if (!content || typeof content.archivedAt === "string") throw new AccessError(404, "card not found");
  const key = hiddenCardKey(session.userId, deckId, cardId);
  if (hidden) {
    await doc.send(
      new PutCommand({
        TableName: tableName(),
        Item: { ...key, deckId, cardId, hiddenAt: new Date().toISOString() },
      })
    );
    return;
  }
  await doc.send(new DeleteCommand({ TableName: tableName(), Key: key }));
}

export async function listHiddenGlobalCards(deckId: string): Promise<Array<Pick<Card, "id" | "deckId" | "front" | "back">>> {
  const session = await sessionOrThrow();
  assertLearner(session);
  const prefix = hiddenPrefix(session.userId, deckId);
  const markers = await queryItems(prefix.PK, prefix.SK, true);
  const hidden: Array<Pick<Card, "id" | "deckId" | "front" | "back">> = [];
  for (const marker of markers) {
    if (typeof marker.cardId !== "string") continue;
    const content = await getItem(globalCardKey(deckId, marker.cardId));
    if (!content || typeof content.archivedAt === "string") continue;
    if (typeof content.front !== "string" || typeof content.back !== "string") continue;
    hidden.push({ id: marker.cardId, deckId, front: content.front, back: content.back });
  }
  return hidden;
}

export async function nextReleaseTeaserForCurrentUser() {
  const session = await sessionOrThrow();
  if (session.role === "admin") return null;
  const items = await queryItems("GLOBAL#DECKS");
  const decks = items
    .filter((item) => typeof item.SK === "string" && item.SK.startsWith("DECK#"))
    .map((item) => deckFromItem(item, String(item.SK).slice("DECK#".length), "global"));
  return nextScheduledTeaser(decks, new Date());
}

export async function setLearnerDisabled(userId: string, disabled: boolean): Promise<void> {
  const session = await sessionOrThrow();
  if (session.role !== "admin" || session.authMode !== "google") {
    throw new AccessError(403, "admin only");
  }
  if (!userId || userId === session.userId) {
    throw new AccessError(403, "You cannot disable your own account");
  }
  const profile = await getItem(userProfileKey(userId));
  const directory = await getItem(userDirectoryKey(userId));
  if (!profile && !directory) throw new AccessError(404, "learner not found");
  if (profile?.role === "admin" || directory?.role === "admin") {
    throw new AccessError(403, "Admin accounts cannot be disabled");
  }
  const status = disabled ? "disabled" : "active";
  const now = new Date().toISOString();
  const names = { "#status": "status" };
  const values = { ":status": status, ":now": now };
  if (profile) {
    await doc.send(
      new UpdateCommand({
        TableName: tableName(),
        Key: userProfileKey(userId),
        UpdateExpression: "SET #status = :status, updatedAt = :now",
        ConditionExpression: "attribute_exists(PK)",
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      })
    );
  }
  if (directory) {
    await doc.send(
      new UpdateCommand({
        TableName: tableName(),
        Key: userDirectoryKey(userId),
        UpdateExpression: "SET #status = :status, updatedAt = :now",
        ConditionExpression: "attribute_exists(PK)",
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      })
    );
  }
}

export async function listAdminUserSummaries() {
  const session = await sessionOrThrow();
  if (session.role !== "admin" || session.authMode !== "google") {
    throw new AccessError(403, "admin only");
  }
  const rows = await queryItems("USERS", "USER#", true);
  const zone = appTimeZone();
  const today = localDateKey(new Date(), zone);
  return rows
    .map((row) => {
      const summary = toAdminUserSummary(row);
      summary.currentStreak = visibleStreak(
        summary.currentStreak,
        studiedOnFromSummary(row, zone, localDateKey),
        today
      );
      return summary;
    })
    .sort((a, b) => a.email.localeCompare(b.email));
}

function reviewReceiptOf(review: PendingReviewWrite): ReviewReceipt {
  return {
    clientReviewId: review.clientReviewId,
    cardId: review.cardId,
    deckId: review.deckId,
    rating: review.rating,
    reviewedAt: review.reviewedAt,
    mode: review.mode ?? "review",
  };
}

export async function getReviewReceiptForCurrentUser(clientReviewId: string): Promise<ReviewReceipt | null> {
  const session = await sessionOrThrow();
  assertLearner(session);
  const item = await getItem({ PK: userReceiptsKey(session.userId), SK: clientReviewId });
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
    mode: (item.mode as ReviewReceipt["mode"]) ?? "review",
  };
}

export async function getCardForReviewForCurrentUser(deckId: string, cardId: string) {
  const session = await sessionOrThrow();
  assertLearner(session);
  const card = await getCardForCurrentUser(deckId, cardId);
  if (!card) return null;
  const deck = await loadDeck(session, deckId);
  if (!deck?.source) return null;
  const progress = await getItem(progressKey(session.userId, deck.source, deckId, cardId));
  const version = typeof progress?.reviewVersion === "number" ? progress.reviewVersion : null;
  return { card, version };
}

function logFields(cardId: string, log: ReviewLog) {
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

function cancellationCodes(error: unknown): string[] {
  if (!error || typeof error !== "object" || !("CancellationReasons" in error)) return [];
  const reasons = (error as { CancellationReasons?: unknown }).CancellationReasons;
  if (!Array.isArray(reasons)) return [];
  return reasons.map((reason) =>
    reason && typeof reason === "object" && "Code" in reason && typeof (reason as { Code?: unknown }).Code === "string"
      ? (reason as { Code: string }).Code
      : ""
  );
}

export async function commitReviewForCurrentUser(review: PendingReviewWrite): Promise<ReviewWriteResult> {
  const session = await sessionOrThrow();
  assertLearner(session);
  if (review.card.id !== review.cardId || review.card.deckId !== review.deckId) {
    throw new Error("Review card identity does not match the request");
  }
  const serverNow = new Date();
  const globalItem = await getItem(globalDeckKey(review.deckId));
  let deck: Deck | null = null;
  if (globalItem && typeof globalItem.archivedAt !== "string") {
    deck = deckFromItem(globalItem, review.deckId, "global");
    if (!isReleasedToLearners(deck, serverNow)) return { status: "unavailable" };
  } else {
    const privateItem = await getItem(privateDeckKey(session.userId, review.deckId));
    if (!privateItem || typeof privateItem.archivedAt === "string") return { status: "conflict" };
    deck = deckFromItem(privateItem, review.deckId, "private");
  }
  if (!deck?.source) return { status: "conflict" };
  const source = deck.source;
  const progress = progressKey(session.userId, source, review.deckId, review.cardId);
  const existingProgress = await getItem(progress);
  const wasStudied = isStudied(existingProgress ? progressFromItem(existingProgress) : null);
  const studiedDelta = !wasStudied && isStudied(review.card) ? 1 : 0;
  const statsItem = await getItem(userStatsKey(session.userId));
  const studiedOn = localDateKey(new Date(review.reviewedAt), appTimeZone());
  const streak = nextStudyStreak(
    typeof statsItem?.currentStreak === "number" ? statsItem.currentStreak : 0,
    typeof statsItem?.lastStudiedOn === "string" ? statsItem.lastStudiedOn : undefined,
    studiedOn
  );
  const nextVersion = (review.expectedVersion ?? 0) + 1;
  const receipt = reviewReceiptOf(review);
  const contentKey = source === "private"
    ? privateCardKey(session.userId, review.deckId, review.cardId)
    : globalCardKey(review.deckId, review.cardId);
  const deckKey = source === "private" ? privateDeckKey(session.userId, review.deckId) : globalDeckKey(review.deckId);
  const versionCondition =
    review.expectedVersion === null ? "attribute_not_exists(reviewVersion)" : "reviewVersion = :expectedVersion";
  const progressValues: Record<string, unknown> = {};
  if (review.expectedVersion !== null) progressValues[":expectedVersion"] = review.expectedVersion;
  try {
    await doc.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            ConditionCheck: {
              TableName: tableName(),
              Key: contentKey,
              ConditionExpression: "attribute_exists(PK) AND attribute_not_exists(archivedAt)",
            },
          },
          {
            ConditionCheck: {
              TableName: tableName(),
              Key: deckKey,
              ConditionExpression:
                source === "private"
                  ? "attribute_exists(PK) AND attribute_not_exists(archivedAt)"
                  : "attribute_exists(PK) AND attribute_not_exists(archivedAt) AND (attribute_not_exists(#status) OR #status = :published OR (#status = :scheduled AND releaseAt <= :now))",
              ...(source === "global"
                ? {
                    ExpressionAttributeNames: { "#status": "status" },
                    ExpressionAttributeValues: {
                      ":published": "published",
                      ":scheduled": "scheduled",
                      ":now": serverNow.toISOString(),
                    },
                  }
                : {}),
            },
          },
          {
            Put: {
              TableName: tableName(),
              Item: {
                ...progress,
                source,
                deckId: review.deckId,
                cardId: review.cardId,
                fsrs: review.card.fsrs,
                ...(review.card.modes ? { modes: review.card.modes } : {}),
                ...(review.card.practice ? { practice: review.card.practice } : {}),
                ...(review.card.hard ? { hard: true } : { hard: false }),
                reviewVersion: nextVersion,
                updatedAt: review.reviewedAt,
              },
              ConditionExpression: versionCondition,
              ...(Object.keys(progressValues).length > 0
                ? { ExpressionAttributeValues: progressValues }
                : {}),
            },
          },
          {
            Put: {
              TableName: tableName(),
              Item: {
                PK: userLogsKey(session.userId),
                SK: `${new Date(review.log.review).toISOString()}#${source}#${review.deckId}#${review.cardId}#${review.clientReviewId}`,
                ...logFields(review.cardId, review.log),
                ...receipt,
                source,
              },
              ConditionExpression: "attribute_not_exists(PK)",
            },
          },
          {
            Put: {
              TableName: tableName(),
              Item: { PK: userReceiptsKey(session.userId), SK: review.clientReviewId, ...receipt, source },
              ConditionExpression: "attribute_not_exists(PK)",
            },
          },
          {
            Update: {
              TableName: tableName(),
              Key: userStatsKey(session.userId),
              UpdateExpression:
                "SET currentStreak = :streak, lastStudiedOn = :day, lastReviewAt = :at, updatedAt = :at ADD reviewCount :one, cardsStudied :studied",
              ExpressionAttributeValues: {
                ":one": 1,
                ":studied": studiedDelta,
                ":streak": streak.currentStreak,
                ":day": streak.lastStudiedOn,
                ":at": review.reviewedAt,
              },
            },
          },
          {
            Update: {
              TableName: tableName(),
              Key: userDirectoryKey(session.userId),
              UpdateExpression:
                "SET userId = if_not_exists(userId, :userId), email = if_not_exists(email, :email), #role = if_not_exists(#role, :role), currentStreak = :streak, lastStudiedOn = :day, lastReviewAt = :at ADD reviewCount :one, cardsStudied :studied",
              ExpressionAttributeNames: { "#role": "role" },
              ExpressionAttributeValues: {
                ":userId": session.userId,
                ":email": session.email,
                ":role": "user",
                ":one": 1,
                ":studied": studiedDelta,
                ":streak": streak.currentStreak,
                ":day": streak.lastStudiedOn,
                ":at": review.reviewedAt,
              },
            },
          },
        ],
      })
    );
    return { status: "committed" };
  } catch (error) {
    if (!(error instanceof Error) || error.name !== "TransactionCanceledException") throw error;
    const existing = await getReviewReceiptForCurrentUser(review.clientReviewId);
    if (!existing) {
      const fresh = await getItem(globalDeckKey(review.deckId));
      if (fresh && typeof fresh.archivedAt !== "string") {
        const visible = deckFromItem(fresh, review.deckId, "global");
        if (!isReleasedToLearners(visible, new Date())) return { status: "unavailable" };
      }
      if (cancellationCodes(error)[1] === "ConditionalCheckFailed") return { status: "unavailable" };
      return { status: "conflict" };
    }
    const same =
      existing.clientReviewId === receipt.clientReviewId &&
      existing.cardId === receipt.cardId &&
      existing.deckId === receipt.deckId &&
      (existing.mode ?? "review") === (receipt.mode ?? "review") &&
      existing.rating === receipt.rating &&
      existing.reviewedAt === receipt.reviewedAt;
    return same ? { status: "duplicate", receipt: existing } : { status: "mismatch", receipt: existing };
  }
}

export async function countReviewLogsForCurrentUser(): Promise<number> {
  const session = await sessionOrThrow();
  if (session.role === "admin") return 0;
  const stats = await getItem(userStatsKey(session.userId));
  return typeof stats?.reviewCount === "number" ? stats.reviewCount : 0;
}

export async function setCardHardForCurrentUser(deckId: string, id: string, hard: boolean): Promise<void> {
  const session = await sessionOrThrow();
  assertLearner(session);
  const deck = await loadDeck(session, deckId);
  if (!deck?.source) throw new AccessError(404, "card not found");
  const contentKey = deck.source === "private"
    ? privateCardKey(session.userId, deckId, id)
    : globalCardKey(deckId, id);
  const content = await getItem(contentKey);
  if (!content || typeof content.archivedAt === "string") throw new AccessError(404, "card not found");
  if (deck.source === "global") {
    const marker = await getItem(hiddenCardKey(session.userId, deckId, id));
    if (marker) throw new AccessError(404, "card not found");
  }
  const key = progressKey(session.userId, deck.source, deckId, id);
  const existing = await getItem(key);
  if (!existing) {
    const createdAt = typeof content.createdAt === "string" ? content.createdAt : new Date().toISOString();
    try {
      await doc.send(
        new PutCommand({
          TableName: tableName(),
          Item: {
            ...key,
            source: deck.source,
            deckId,
            cardId: id,
            fsrs: emptyCardState(new Date(createdAt)),
            hard,
            reviewVersion: 1,
            updatedAt: new Date().toISOString(),
          },
          ConditionExpression: "attribute_not_exists(PK)",
        })
      );
      return;
    } catch (error) {
      if (!(error instanceof Error) || error.name !== "ConditionalCheckFailedException") throw error;
    }
  }
  await doc.send(
    new UpdateCommand({
      TableName: tableName(),
      Key: key,
      UpdateExpression: "SET #hard = :hard, updatedAt = :updatedAt ADD reviewVersion :one",
      ExpressionAttributeNames: { "#hard": "hard" },
      ExpressionAttributeValues: { ":hard": hard, ":updatedAt": new Date().toISOString(), ":one": 1 },
    })
  );
}
