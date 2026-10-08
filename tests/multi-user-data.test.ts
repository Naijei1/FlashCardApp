import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CreateTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { State } from "@/lib/fsrs";
import { migrateMultiUser, MigrationError, type MigrationReport } from "@/lib/migration";
import { rateMode } from "@/lib/modes";
import type { AuthSession } from "@/lib/auth";
import type { Card } from "@/lib/types";
import { ensureDynamoLocal } from "./dynamodb-local";

const TABLE = "flashcards-migration-test";
const ENDPOINT = "http://127.0.0.1:8000";
const CREATED_AT = "2026-01-01T00:00:00.000Z";

const naijei: AuthSession = { userId: "naijei-sub", role: "user", isAdmin: false };
const other: AuthSession = { userId: "other-sub", role: "user", isAdmin: false };
const admin: AuthSession = { userId: "admin-sub", role: "admin", isAdmin: true };

const config = {
  naijeiUserId: naijei.userId,
  adminUserId: admin.userId,
  naijeiEmail: "naijei@example.com",
  adminEmail: "admin@example.com",
  decks: {
    "deck-global": "global" as const,
    "deck-private": "private" as const,
  },
};

let raw: DynamoDBClient;
let docs: DynamoDBDocumentClient;
let db: typeof import("@/lib/db");

function studiedCard(): Card & { reviewVersion: number } {
  const created = {
    id: "card-global",
    deckId: "deck-global",
    front: "你好",
    back: "hello",
    notes: "tone",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    fsrs: {
      due: CREATED_AT,
      stability: 0,
      difficulty: 0,
      elapsed_days: 0,
      scheduled_days: 0,
      learning_steps: 0,
      reps: 0,
      lapses: 0,
      state: State.New,
    },
  } satisfies Card;
  let card = rateMode(created, "review", 3, new Date("2026-02-01T00:00:00.000Z")).card;
  card = rateMode(card, "write", 2, new Date("2026-02-02T00:00:00.000Z")).card;
  card = rateMode(card, "pinyin", 1, new Date("2026-02-03T00:00:00.000Z")).card;
  delete card.fsrs.retentionTarget;
  card.fsrs = {
    ...card.fsrs,
    state: State.Review,
    stability: 12,
    last_review: "2026-01-20T00:00:00.000Z",
    due: "2026-06-01T00:00:00.000Z",
  };
  card.hard = true;
  return { ...card, reviewVersion: 7 };
}

async function recreateTable(): Promise<void> {
  const existing = await raw.send(new (await import("@aws-sdk/client-dynamodb")).ListTablesCommand({}));
  if (existing.TableNames?.includes(TABLE)) {
    await raw.send(new (await import("@aws-sdk/client-dynamodb")).DeleteTableCommand({ TableName: TABLE }));
  }
  await raw.send(
    new CreateTableCommand({
      TableName: TABLE,
      AttributeDefinitions: [
        { AttributeName: "PK", AttributeType: "S" },
        { AttributeName: "SK", AttributeType: "S" },
      ],
      KeySchema: [
        { AttributeName: "PK", KeyType: "HASH" },
        { AttributeName: "SK", KeyType: "RANGE" },
      ],
      BillingMode: "PAY_PER_REQUEST",
    })
  );
}

async function put(item: Record<string, unknown>): Promise<void> {
  await docs.send(new PutCommand({ TableName: TABLE, Item: item }));
}

async function get(key: { PK: string; SK: string }): Promise<Record<string, unknown> | undefined> {
  const response = await docs.send(
    new GetCommand({
      TableName: TABLE,
      Key: { PK: key.PK, SK: key.SK },
      ConsistentRead: true,
    })
  );
  return response.Item as Record<string, unknown> | undefined;
}

beforeAll(async () => {
  const endpoint = await ensureDynamoLocal();
  process.env.DYNAMODB_ENDPOINT = endpoint;
  process.env.TABLE_NAME = TABLE;
  process.env.APP_REGION = "us-east-1";
  process.env.AUTH_MODE = "local-dev";
  delete (globalThis as { __ddb?: unknown }).__ddb;
  raw = new DynamoDBClient({
    region: "us-east-1",
    endpoint,
    credentials: { accessKeyId: "local", secretAccessKey: "local" },
  });
  docs = DynamoDBDocumentClient.from(raw, { marshallOptions: { removeUndefinedValues: true } });
  db = await import("@/lib/db");
}, 30_000);

beforeEach(async () => {
  await recreateTable();
});

describe("multi-user migration and isolation", () => {
  it("preserves FSRS, modes, hard markers, logs, and stats, and can be rerun", async () => {
    const card = studiedCard();
    const privateCard: Card = {
      id: "card-private",
      deckId: "deck-private",
      front: "私人",
      back: "private",
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
      fsrs: card.fsrs,
    };
    await put({
      PK: "DECKS",
      SK: "DECK#deck-global",
      name: "Global",
      frontLanguage: "zh-CN",
      backLanguage: "en",
      chineseSide: "front",
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    });
    await put({
      PK: "DECKS",
      SK: "DECK#deck-private",
      name: "Private",
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    });
    await put({
      PK: "DECKS",
      SK: "DECK#gone",
      name: "Deleting",
      deletingAt: CREATED_AT,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    });
    await put({
      PK: "DECK#deck-global",
      SK: "CARD#card-global",
      front: card.front,
      back: card.back,
      notes: card.notes,
      createdAt: card.createdAt,
      updatedAt: card.updatedAt,
      fsrs: card.fsrs,
      modes: card.modes,
      practice: card.practice,
      hard: true,
      reviewVersion: 7,
    });
    await put({
      PK: "DECK#deck-private",
      SK: "CARD#card-private",
      front: privateCard.front,
      back: privateCard.back,
      createdAt: privateCard.createdAt,
      updatedAt: privateCard.updatedAt,
      fsrs: privateCard.fsrs,
    });
    const legacyLog = {
      PK: "LOGS",
      SK: "2026-02-02T00:00:00.000Z#card-global#review_id_write1",
      cardId: "card-global",
      deckId: "deck-global",
      clientReviewId: "review_id_write1",
      mode: "write",
      rating: 2,
      state: 1,
      reviewedAt: "2026-02-02T00:00:00.000Z",
      appliedAt: "2026-02-02T00:00:00.000Z",
      due: "2026-02-02T01:00:00.000Z",
      stability: 3.5,
      difficulty: 6.25,
      elapsed_days: 1,
      scheduled_days: 0,
    };
    const legacyReceipt = {
      PK: "REVIEW_REQUESTS",
      SK: "review_id_write1",
      clientReviewId: "review_id_write1",
      cardId: "card-global",
      deckId: "deck-global",
      mode: "write",
      rating: 2,
      reviewedAt: "2026-02-02T00:00:00.000Z",
    };
    await put(legacyLog);
    await put(legacyReceipt);
    await put({
      PK: "META",
      SK: "STATS",
      reviewCount: 2,
      reviewCountVersion: 1,
      updatedAt: "2026-02-03T00:00:00.000Z",
    });
    const legacyBefore = await get({ PK: "DECK#deck-global", SK: "CARD#card-global" });

    const report = await migrateMultiUser({
      tableName: TABLE,
      endpoint: ENDPOINT,
      config,
      now: new Date("2026-03-01T00:00:00.000Z"),
    });
    expect(report).toMatchObject({
      sourceDeckCount: 2,
      globalDeckCount: 1,
      privateDeckCount: 1,
      sourceCardCount: 2,
      migratedContentCount: 4,
      migratedProgressCount: 2,
      reviewLogCount: 1,
      reviewReceiptCount: 1,
      hardMarkerCount: 1,
      dueBefore: report.dueAfter,
      newBefore: report.newAfter,
    } satisfies Partial<MigrationReport>);

    expect(await get({ PK: "DECK#deck-global", SK: "CARD#card-global" })).toEqual(legacyBefore);
    expect(await get(legacyLog)).toEqual(legacyLog);
    const progress = await get({
      PK: "USER#naijei-sub",
      SK: "PROGRESS#GLOBAL#deck-global#CARD#card-global",
    });
    expect(progress?.fsrs).toEqual(legacyBefore?.fsrs);
    expect(progress?.modes).toEqual(legacyBefore?.modes);
    expect(progress?.practice).toEqual(legacyBefore?.practice);
    expect(progress?.hard).toBe(true);
    expect(progress?.reviewVersion).toBe(7);
    expect(progress?.fsrs).not.toHaveProperty("retentionTarget");
    const content = await get({ PK: "GLOBAL#DECK#deck-global", SK: "CARD#card-global" });
    expect(content).toMatchObject({ front: "你好", back: "hello", notes: "tone", source: "global" });
    expect(content).not.toHaveProperty("fsrs");
    expect(content).not.toHaveProperty("hard");
    expect(content).not.toHaveProperty("modes");
    const migratedLog = await docs.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: { ":pk": "USER#naijei-sub#LOGS" },
        ConsistentRead: true,
      })
    );
    expect(migratedLog.Items?.[0]).toMatchObject({
      source: "global",
      mode: "write",
      rating: 2,
      stability: 3.5,
      difficulty: 6.25,
      elapsed_days: 1,
      scheduled_days: 0,
      due: "2026-02-02T01:00:00.000Z",
      clientReviewId: "review_id_write1",
    });
    expect(await get({ PK: "USER#naijei-sub#META", SK: "STATS" })).toMatchObject({
      reviewCount: 2,
      reviewCountVersion: 1,
    });
    expect(await get({ PK: "USER#admin-sub#META", SK: "STATS" })).toBeUndefined();
    const adminRows = await docs.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: { ":pk": "USER#admin-sub" },
        ConsistentRead: true,
      })
    );
    expect(adminRows.Items?.map((item) => item.SK)).toEqual(["PROFILE"]);
    expect(await get({ PK: "GLOBAL#DECKS", SK: "DECK#gone" })).toBeUndefined();

    const again = await migrateMultiUser({
      tableName: TABLE,
      endpoint: ENDPOINT,
      config,
      now: new Date("2026-04-01T00:00:00.000Z"),
    });
    expect(again.createdCount).toBe(0);
    expect(again.skippedExisting).toBeGreaterThan(0);
    expect(await get({ PK: "DECK#deck-global", SK: "CARD#card-global" })).toEqual(legacyBefore);
    expect(await get({
      PK: "USER#naijei-sub",
      SK: "PROGRESS#GLOBAL#deck-global#CARD#card-global",
    })).toEqual(progress);

    const visible = await db.getCard("deck-global", "card-global", naijei);
    expect(visible?.fsrs.retentionTarget).toBe(0.95);
    expect(visible?.hard).toBe(true);
    expect(visible?.modes?.write?.fsrs.reps).toBeGreaterThan(0);
    expect(visible?.modes?.pinyin?.fsrs.reps).toBeGreaterThan(0);
    expect((await db.listDecks(other)).map((deck) => deck.id)).toEqual(["deck-global"]);
    expect(await db.getCard("deck-private", "card-private", other)).toBeNull();
    expect((await db.getCard("deck-private", "card-private", naijei))?.front).toBe("私人");
    const foreign = await db.getCard("deck-global", "card-global", other);
    expect(foreign?.fsrs.reps).toBe(0);
    expect(foreign?.hard).toBeUndefined();

    await db.hideGlobalDeck("deck-global", other);
    expect((await db.listDecks(other)).map((deck) => deck.id)).not.toContain("deck-global");
    expect((await db.listDecks(naijei)).map((deck) => deck.id)).toContain("deck-global");
    await db.unhideGlobalDeck("deck-global", other);
    await db.hideGlobalCard("deck-global", "card-global", other);
    expect(await db.getCard("deck-global", "card-global", other)).toBeNull();
    expect((await db.listCards("deck-global", { session: other })).map((item) => item.id)).not.toContain(
      "card-global"
    );
    expect((await db.getCard("deck-global", "card-global", naijei))?.fsrs).toEqual(visible?.fsrs);
    await db.unhideGlobalCard("deck-global", "card-global", other);
    expect((await db.getCard("deck-global", "card-global", other))?.fsrs.reps).toBe(0);

    const found = await db.getCardForReview("deck-global", "card-global", other);
    if (!found) throw new Error("expected a visible global card");
    const rated = rateMode(found.card, "review", 4, new Date("2026-03-02T00:00:00.000Z"));
    await db.commitReview({
      clientReviewId: "other_review_01",
      cardId: "card-global",
      deckId: "deck-global",
      source: "global",
      rating: 4,
      reviewedAt: "2026-03-02T00:00:00.000Z",
      mode: "review",
      card: rated.card,
      expectedVersion: found.version,
      log: rated.log,
      session: other,
    });
    expect(await get({
      PK: "USER#naijei-sub",
      SK: "PROGRESS#GLOBAL#deck-global#CARD#card-global",
    })).toEqual(progress);
    expect((await get({
      PK: "USER#other-sub",
      SK: "PROGRESS#GLOBAL#deck-global#CARD#card-global",
    }))?.fsrs).toMatchObject({ reps: expect.any(Number) });
    await expect(db.commitReview({
      clientReviewId: "admin_review_01",
      cardId: "card-global",
      deckId: "deck-global",
      rating: 3,
      reviewedAt: "2026-03-03T00:00:00.000Z",
      card: found.card,
      expectedVersion: null,
      log: rated.log,
      session: admin,
    })).rejects.toThrow(/Admin/);
    expect((await db.getCard("deck-global", "card-global", admin))?.fsrs.reps).toBe(0);
  });

  it("fails before writing when a deck is unclassified", async () => {
    await put({
      PK: "DECKS",
      SK: "DECK#deck-secret",
      name: "Secret",
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    });
    await put({
      PK: "DECK#deck-secret",
      SK: "CARD#card-secret",
      front: "secret",
      back: "secret",
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
      fsrs: { due: CREATED_AT, stability: 1, difficulty: 1, elapsed_days: 0, scheduled_days: 0, learning_steps: 0, reps: 1, lapses: 0, state: State.Review },
    });
    const error = await migrateMultiUser({
      tableName: TABLE,
      endpoint: ENDPOINT,
      config: { ...config, decks: {} },
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MigrationError);
    expect((error as MigrationError).code).toBe("unclassified_decks");
    expect(String((error as Error).message)).toContain("deck-secret");
    expect(await get({ PK: "GLOBAL#DECKS", SK: "DECK#deck-secret" })).toBeUndefined();
    expect(await get({ PK: "DECK#deck-secret", SK: "CARD#card-secret" })).toMatchObject({ front: "secret" });
  });
});
