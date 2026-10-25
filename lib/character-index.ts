import {
  BatchWriteCommand,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
  type BatchWriteCommandInput,
} from "@aws-sdk/lib-dynamodb";
import {
  characterPartition,
  planIndexWrites,
  type IndexScope,
  type IndexWrite,
} from "./characters";
import { doc, tableName } from "./dynamo";
import { globalCardKey, privateCardKey } from "./multi-user-model";

type Item = Record<string, unknown>;

export type IndexCardInput = {
  deckId: string;
  cardId: string;
  front: string;
  back: string;
  updatedAt: string;
  previousFront?: string;
  previousBack?: string;
};

const CARD_PAGE = 20;

function metaKey(scope: IndexScope): { PK: string; SK: string } {
  if (scope.kind === "legacy") return { PK: "CIDXMETA", SK: "LEGACY" };
  if (scope.kind === "global") return { PK: "CIDXMETA", SK: "GLOBAL" };
  return { PK: "CIDXMETA", SK: `USER#${scope.userId}` };
}

function cardKey(scope: IndexScope, deckId: string, cardId: string): { PK: string; SK: string } {
  if (scope.kind === "global") return globalCardKey(deckId, cardId);
  if (scope.kind === "private") return privateCardKey(scope.userId, deckId, cardId);
  return { PK: `DECK#${deckId}`, SK: `CARD#${cardId}` };
}

function deckPartition(scope: IndexScope): string {
  if (scope.kind === "global") return "GLOBAL#DECKS";
  if (scope.kind === "private") return `USER#${scope.userId}#DECKS`;
  return "DECKS";
}

function cardsPartition(scope: IndexScope, deckId: string): string {
  if (scope.kind === "global") return `GLOBAL#DECK#${deckId}`;
  if (scope.kind === "private") return `USER#${scope.userId}#DECK#${deckId}`;
  return `DECK#${deckId}`;
}

export async function queryPartition(pk: string, skPrefix?: string, consistent = false): Promise<Item[]> {
  const items: Item[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const res = await doc.send(
      new QueryCommand({
        TableName: tableName(),
        KeyConditionExpression: skPrefix ? "PK = :pk AND begins_with(SK, :sk)" : "PK = :pk",
        ExpressionAttributeValues: skPrefix ? { ":pk": pk, ":sk": skPrefix } : { ":pk": pk },
        ExclusiveStartKey: startKey,
        ConsistentRead: consistent || undefined,
      })
    );
    items.push(...((res.Items ?? []) as Item[]));
    startKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (startKey);
  return items;
}

async function queryPage(
  pk: string,
  skPrefix: string,
  startKey: Record<string, unknown> | undefined
): Promise<{ items: Item[]; next?: Record<string, unknown> }> {
  const res = await doc.send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: { ":pk": pk, ":sk": skPrefix },
      ExclusiveStartKey: startKey,
      Limit: CARD_PAGE,
    })
  );
  return {
    items: (res.Items ?? []) as Item[],
    next: res.LastEvaluatedKey as Record<string, unknown> | undefined,
  };
}

type BatchRequest = NonNullable<BatchWriteCommandInput["RequestItems"]>[string][number];

async function batchWrite(requests: BatchRequest[]): Promise<void> {
  if (requests.length === 0) return;
  const name = tableName();
  for (let index = 0; index < requests.length; index += 25) {
    let pending = requests.slice(index, index + 25);
    for (let attempt = 0; pending.length > 0; attempt++) {
      if (attempt >= 8) throw new Error("DynamoDB character index write did not complete");
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 50 * 2 ** attempt));
      const res = await doc.send(new BatchWriteCommand({ RequestItems: { [name]: pending } }));
      pending = (res.UnprocessedItems?.[name] ?? []) as BatchRequest[];
    }
  }
}

function toRequest(write: IndexWrite): BatchRequest {
  if (write.op === "delete") {
    return { DeleteRequest: { Key: { PK: write.pk, SK: write.sk } } };
  }
  return {
    PutRequest: {
      Item: {
        PK: write.pk,
        SK: write.sk,
        deckId: write.deckId,
        cardId: write.cardId,
        front: write.front,
        back: write.back,
        updatedAt: write.updatedAt,
      },
    },
  };
}

/** Refresh character rows after a card create, edit, move, or delete. No-op without hanzi. */
export async function syncCharacterIndexes(scope: IndexScope, cards: readonly IndexCardInput[]): Promise<void> {
  const writes = cards.flatMap((card) => planIndexWrites({ scope, ...card }));
  await batchWrite(writes.map(toRequest));
}

export async function queryCharacterEntries(
  scope: IndexScope,
  character: string
): Promise<Array<{ deckId: string; cardId: string; front: string; back: string }>> {
  const items = await queryPartition(characterPartition(scope, character), undefined, true);
  const entries: Array<{ deckId: string; cardId: string; front: string; back: string }> = [];
  for (const item of items) {
    if (typeof item.deckId !== "string" || typeof item.front !== "string" || typeof item.back !== "string") {
      continue;
    }
    const cardId = typeof item.cardId === "string" ? item.cardId : typeof item.SK === "string" ? item.SK : "";
    if (!cardId) continue;
    entries.push({ deckId: item.deckId, cardId, front: item.front, back: item.back });
  }
  return entries;
}

function conditionFailed(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "ConditionalCheckFailedException") return true;
  if (error.name !== "TransactionCanceledException") return false;
  const reasons = (error as { CancellationReasons?: Array<{ Code?: string }> }).CancellationReasons;
  const codes = (reasons ?? []).map((reason) => reason.Code).filter((code) => code && code !== "None");
  return codes.length > 0 && codes.every((code) => code === "ConditionalCheckFailed");
}

async function indexStoredCard(scope: IndexScope, deckId: string, item: Item): Promise<void> {
  if (typeof item.archivedAt === "string" || typeof item.deletingAt === "string") return;
  if (typeof item.front !== "string" || typeof item.back !== "string" || typeof item.SK !== "string") return;
  const cardId = item.SK.startsWith("CARD#") ? item.SK.slice("CARD#".length) : item.SK;
  const front = item.front;
  const back = item.back;
  const updatedAt = typeof item.updatedAt === "string" ? item.updatedAt : "";
  const writes = planIndexWrites({
    scope,
    deckId,
    cardId,
    front,
    back,
    updatedAt: updatedAt || new Date(0).toISOString(),
  });
  const puts = writes.filter((write): write is Extract<IndexWrite, { op: "put" }> => write.op === "put");
  if (puts.length === 0) return;
  const name = tableName();
  const key = cardKey(scope, deckId, cardId);
  const condition = updatedAt
    ? "attribute_exists(PK) AND attribute_not_exists(archivedAt) AND updatedAt = :updatedAt"
    : "attribute_exists(PK) AND attribute_not_exists(archivedAt) AND attribute_not_exists(updatedAt)";
  for (let index = 0; index < puts.length; index += 90) {
    const chunk = puts.slice(index, index + 90);
    try {
      await doc.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              ConditionCheck: {
                TableName: name,
                Key: key,
                ConditionExpression: condition,
                ...(updatedAt ? { ExpressionAttributeValues: { ":updatedAt": updatedAt } } : {}),
              },
            },
            ...chunk.map((write) => ({
              Update: {
                TableName: name,
                Key: { PK: write.pk, SK: write.sk },
                UpdateExpression:
                  "SET deckId = :deckId, cardId = :cardId, front = :front, back = :back, updatedAt = :updatedAt",
                ExpressionAttributeValues: {
                  ":deckId": write.deckId,
                  ":cardId": write.cardId,
                  ":front": write.front,
                  ":back": write.back,
                  ":updatedAt": write.updatedAt,
                },
              },
            })),
          ],
        })
      );
    } catch (error) {
      if (conditionFailed(error)) return;
      throw error;
    }
  }
}

type Cursor = {
  ready?: boolean;
  deckIds?: string[];
  deckPos?: number;
  startKey?: { PK: string; SK: string };
};

function cursorFrom(item: Item | undefined): Cursor {
  if (!item) return {};
  const start = item.startKey;
  const startKey =
    start && typeof start === "object" && typeof (start as Item).PK === "string" && typeof (start as Item).SK === "string"
      ? { PK: String((start as Item).PK), SK: String((start as Item).SK) }
      : undefined;
  return {
    ready: item.ready === true,
    deckIds: Array.isArray(item.deckIds) ? item.deckIds.filter((id): id is string => typeof id === "string") : undefined,
    deckPos: typeof item.deckPos === "number" ? item.deckPos : 0,
    startKey,
  };
}

async function readCursor(scope: IndexScope): Promise<Cursor> {
  const res = await doc.send(
    new GetCommand({ TableName: tableName(), Key: metaKey(scope), ConsistentRead: true })
  );
  return cursorFrom(res.Item as Item | undefined);
}

function activeDeckId(item: Item): string | null {
  if (typeof item.SK !== "string" || !item.SK.startsWith("DECK#")) return null;
  if (typeof item.archivedAt === "string" || typeof item.deletingAt === "string") return null;
  return item.SK.slice("DECK#".length);
}

async function ensureDeckList(scope: IndexScope): Promise<Cursor> {
  const key = metaKey(scope);
  const current = await readCursor(scope);
  if (current.ready || current.deckIds) return current;
  const deckIds = (await queryPartition(deckPartition(scope)))
    .map(activeDeckId)
    .filter((id): id is string => !!id);
  try {
    await doc.send(
      new UpdateCommand({
        TableName: tableName(),
        Key: key,
        UpdateExpression: "SET deckIds = :deckIds, deckPos = :zero, ready = :ready",
        ConditionExpression: "attribute_not_exists(deckIds) AND attribute_not_exists(ready)",
        ExpressionAttributeValues: { ":deckIds": deckIds, ":zero": 0, ":ready": false },
      })
    );
  } catch (error) {
    if (!conditionFailed(error)) throw error;
  }
  return readCursor(scope);
}

function cursorCondition(cursor: Cursor): {
  expression: string;
  names?: Record<string, string>;
  values: Record<string, unknown>;
} {
  const values: Record<string, unknown> = { ":pos": cursor.deckPos ?? 0 };
  if (!cursor.startKey) {
    return { expression: "deckPos = :pos AND attribute_not_exists(startKey)", values };
  }
  values[":startPk"] = cursor.startKey.PK;
  values[":startSk"] = cursor.startKey.SK;
  return {
    expression: "deckPos = :pos AND startKey.#pk = :startPk AND startKey.#sk = :startSk",
    names: { "#pk": "PK", "#sk": "SK" },
    values,
  };
}

/** Move the backfill cursor only if nobody else already passed this page. */
async function saveCursor(scope: IndexScope, cursor: Cursor, next: Cursor): Promise<boolean> {
  const guard = cursorCondition(cursor);
  const values = { ...guard.values };
  let update = "SET deckPos = :nextPos REMOVE startKey";
  if (next.ready) {
    update = "SET ready = :ready REMOVE deckIds, startKey";
    values[":ready"] = true;
  } else if (next.startKey) {
    update = "SET deckPos = :nextPos, startKey = :startKey";
    values[":nextPos"] = next.deckPos ?? 0;
    values[":startKey"] = next.startKey;
  } else {
    values[":nextPos"] = next.deckPos ?? 0;
  }
  try {
    await doc.send(
      new UpdateCommand({
        TableName: tableName(),
        Key: metaKey(scope),
        UpdateExpression: update,
        ConditionExpression: guard.expression,
        ...(guard.names ? { ExpressionAttributeNames: guard.names } : {}),
        ExpressionAttributeValues: values,
      })
    );
    return true;
  } catch (error) {
    if (conditionFailed(error)) return false;
    throw error;
  }
}

/** Index one page of an existing scope. Safe to call from every lookup until ready. */
export async function advanceCharacterIndex(scope: IndexScope): Promise<"ready" | "progress"> {
  const cursor = await ensureDeckList(scope);
  if (cursor.ready) return "ready";
  const deckIds = cursor.deckIds ?? [];
  const deckPos = cursor.deckPos ?? 0;
  if (deckPos >= deckIds.length) {
    const saved = await saveCursor(scope, cursor, { ready: true, deckPos });
    return saved ? "ready" : "progress";
  }
  const deckId = deckIds[deckPos];
  const page = await queryPage(cardsPartition(scope, deckId), "CARD#", cursor.startKey);
  for (const item of page.items) {
    await indexStoredCard(scope, deckId, item);
  }
  const saved = await saveCursor(scope, cursor, {
    deckPos: page.next ? deckPos : deckPos + 1,
    startKey: page.next ? { PK: String(page.next.PK), SK: String(page.next.SK) } : undefined,
    ready: !page.next && deckPos + 1 >= deckIds.length,
  });
  if (saved && !page.next && deckPos + 1 >= deckIds.length) return "ready";
  return "progress";
}

export async function characterIndexReady(scope: IndexScope): Promise<boolean> {
  const cursor = await readCursor(scope);
  return cursor.ready === true;
}

/** Keep walking the backfill until every scope is ready or the time budget runs out. */
export async function warmCharacterIndexes(scopes: readonly IndexScope[], budgetMs: number): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  const pending = [...scopes];
  while (pending.length > 0 && Date.now() < deadline) {
    const scope = pending[0];
    const step = await advanceCharacterIndex(scope);
    if (step === "ready") pending.shift();
  }
  if (pending.length === 0) return true;
  const states = await Promise.all(pending.map((scope) => characterIndexReady(scope)));
  return states.every(Boolean);
}
