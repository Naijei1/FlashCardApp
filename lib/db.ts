import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  ScanCommand,
  GetCommand,
  PutCommand,
  DeleteCommand,
  BatchWriteCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import type { Card, Deck } from "./types";
import type { ReviewLog } from "ts-fsrs";

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

function toDeck(item: Item): Deck {
  const { PK, SK, ...rest } = item;
  void PK;
  return { ...(rest as Omit<Deck, "id">), id: (SK as string).slice("DECK#".length) };
}

function toCard(item: Item): Card {
  const { PK, SK, ...rest } = item;
  return {
    ...(rest as Omit<Card, "id" | "deckId">),
    deckId: (PK as string).slice("DECK#".length),
    id: (SK as string).slice("CARD#".length),
  };
}

export async function listDecks(): Promise<Deck[]> {
  const res = await db.send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: { ":pk": "DECKS" },
    })
  );
  return (res.Items ?? []).map(toDeck).sort((a, b) => a.name.localeCompare(b.name));
}

export async function getDeck(id: string): Promise<Deck | null> {
  const res = await db.send(
    new GetCommand({ TableName: tableName(), Key: deckKey(id) })
  );
  return res.Item ? toDeck(res.Item) : null;
}

export async function putDeck(deck: Deck): Promise<void> {
  const { id, ...rest } = deck;
  await db.send(
    new PutCommand({
      TableName: tableName(),
      Item: { ...deckKey(id), ...rest },
    })
  );
}

export async function listCards(deckId: string): Promise<Card[]> {
  const items: Item[] = [];
  let startKey: Item | undefined;
  do {
    const res = await db.send(
      new QueryCommand({
        TableName: tableName(),
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: { ":pk": `DECK#${deckId}`, ":sk": "CARD#" },
        ExclusiveStartKey: startKey,
      })
    );
    items.push(...(res.Items ?? []));
    startKey = res.LastEvaluatedKey;
  } while (startKey);
  return items.map(toCard);
}

/** All cards across all decks. Scan is fine at single-user scale. */
export async function scanAllCards(): Promise<Card[]> {
  const items: Item[] = [];
  let startKey: Item | undefined;
  do {
    const res = await db.send(
      new ScanCommand({
        TableName: tableName(),
        FilterExpression: "begins_with(SK, :sk)",
        ExpressionAttributeValues: { ":sk": "CARD#" },
        ExclusiveStartKey: startKey,
      })
    );
    items.push(...(res.Items ?? []));
    startKey = res.LastEvaluatedKey;
  } while (startKey);
  return items.map(toCard);
}

export async function getCard(deckId: string, id: string): Promise<Card | null> {
  const res = await db.send(
    new GetCommand({ TableName: tableName(), Key: cardKey(deckId, id) })
  );
  return res.Item ? toCard(res.Item) : null;
}

export async function putCard(card: Card): Promise<void> {
  const { id, deckId, ...rest } = card;
  await db.send(
    new PutCommand({
      TableName: tableName(),
      Item: { ...cardKey(deckId, id), ...rest },
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

export async function batchPutCards(cards: Card[]): Promise<void> {
  await batchWrite(
    cards.map(({ id, deckId, ...rest }) => ({
      PutRequest: { Item: { ...cardKey(deckId, id), ...rest } },
    }))
  );
}

export async function deleteCard(deckId: string, id: string): Promise<void> {
  await db.send(
    new DeleteCommand({ TableName: tableName(), Key: cardKey(deckId, id) })
  );
}

/** Move = PK change, so transactionally delete + put keeping id and FSRS state. */
export async function moveCard(card: Card, toDeckId: string): Promise<Card> {
  const moved: Card = { ...card, deckId: toDeckId, updatedAt: new Date().toISOString() };
  const { id, deckId, ...rest } = moved;
  await db.send(
    new TransactWriteCommand({
      TransactItems: [
        { Delete: { TableName: tableName(), Key: cardKey(card.deckId, card.id) } },
        {
          Put: {
            TableName: tableName(),
            Item: { ...cardKey(deckId, id), ...rest },
          },
        },
      ],
    })
  );
  return moved;
}

/** Delete a deck and all of its cards (25-item batch chunks). */
export async function deleteDeck(id: string): Promise<void> {
  const cards = await listCards(id);
  const keys = [
    ...cards.map((c) => cardKey(c.deckId, c.id)),
    deckKey(id),
  ];
  await batchWrite(keys.map((Key) => ({ DeleteRequest: { Key } })));
}

export async function putReviewLog(cardId: string, log: ReviewLog): Promise<void> {
  await db.send(
    new PutCommand({
      TableName: tableName(),
      Item: {
        PK: "LOGS",
        SK: `${new Date(log.review).toISOString()}#${cardId}`,
        cardId,
        rating: log.rating,
        state: log.state,
        due: new Date(log.due).toISOString(),
        stability: log.stability,
        difficulty: log.difficulty,
        elapsed_days: log.elapsed_days,
        scheduled_days: log.scheduled_days,
      },
    })
  );
}

export async function countReviewLogs(): Promise<number> {
  let count = 0;
  let startKey: Item | undefined;
  do {
    const res = await db.send(
      new QueryCommand({
        TableName: tableName(),
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: { ":pk": "LOGS" },
        Select: "COUNT",
        ExclusiveStartKey: startKey,
      })
    );
    count += res.Count ?? 0;
    startKey = res.LastEvaluatedKey;
  } while (startKey);
  return count;
}
