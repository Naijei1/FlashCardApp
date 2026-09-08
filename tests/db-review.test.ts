import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyRating, emptyCardState, Rating } from "@/lib/fsrs";
import type { Card } from "@/lib/types";

const awsMocks = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock("@aws-sdk/lib-dynamodb", async (importOriginal) => {
  const original = await importOriginal<typeof import("@aws-sdk/lib-dynamodb")>();
  return {
    ...original,
    DynamoDBDocumentClient: {
      from: () => ({ send: awsMocks.send }),
    },
  };
});

const REVIEWED_AT = "2026-09-03T14:00:00.000Z";

function card(): Card {
  const createdAt = "2026-09-01T12:00:00.000Z";
  return {
    id: "card-1",
    deckId: "deck-1",
    front: "front",
    back: "back",
    createdAt,
    updatedAt: REVIEWED_AT,
    fsrs: emptyCardState(new Date(createdAt)),
  };
}

async function loadDb() {
  return import("@/lib/db");
}

beforeEach(() => {
  vi.resetModules();
  awsMocks.send.mockReset();
  delete (globalThis as typeof globalThis & { __ddb?: unknown }).__ddb;
  process.env.TABLE_NAME = "test-table";
});

describe("atomic review persistence", () => {
  it("strongly reads cards and advances the lock version on ordinary edits", async () => {
    awsMocks.send
      .mockResolvedValueOnce({
        Item: {
          PK: "DECK#deck-1",
          SK: "CARD#card-1",
          front: "front",
          back: "back",
          createdAt: REVIEWED_AT,
          updatedAt: REVIEWED_AT,
          fsrs: emptyCardState(new Date(REVIEWED_AT)),
          reviewVersion: 3,
        },
      })
      .mockResolvedValueOnce({});
    const db = await loadDb();

    const existing = await db.getCard("deck-1", "card-1");
    if (!existing) throw new Error("expected card");
    expect(Object.getOwnPropertySymbols(existing)).toEqual([]);
    expect(existing).not.toHaveProperty("reviewVersion");
    existing.front = "edited";
    await db.putCard(existing);

    expect(awsMocks.send.mock.calls[0][0].input.ConsistentRead).toBe(true);
    expect(awsMocks.send.mock.calls[1][0].input).toMatchObject({
      ConditionExpression: "attribute_exists(#pk) AND #reviewVersion = :reviewVersion",
      ExpressionAttributeValues: {
        ":reviewVersion": 3,
        ":nextReviewVersion": 4,
      },
    });
    expect(awsMocks.send.mock.calls[1][0].input.UpdateExpression).toContain(
      "#reviewVersion = :nextReviewVersion"
    );
  });

  it("writes the versioned card, idempotency log, and counter in one transaction", async () => {
    awsMocks.send
      .mockResolvedValueOnce({ Item: { PK: "META", SK: "STATS", reviewCount: 8 } })
      .mockResolvedValueOnce({});
    const db = await loadDb();
    const original = card();
    const { fsrs, log } = applyRating(
      original.fsrs,
      Rating.Good,
      new Date(REVIEWED_AT)
    );

    const result = await db.commitReview({
      clientReviewId: "review_id_123456",
      cardId: original.id,
      deckId: original.deckId,
      rating: Rating.Good,
      reviewedAt: REVIEWED_AT,
      card: { ...original, fsrs },
      expectedVersion: null,
      log,
    });

    expect(result).toEqual({ status: "committed" });
    const transaction = awsMocks.send.mock.calls[1][0];
    const writes = transaction.input.TransactItems;
    expect(writes).toHaveLength(5);
    expect(writes[0].Put.Item).toMatchObject({
      PK: "DECK#deck-1",
      SK: "CARD#card-1",
      reviewVersion: 1,
    });
    expect(writes[0].Put.ConditionExpression).toContain(
      "attribute_not_exists(#reviewVersion)"
    );
    expect(writes[1].Put.Item).toMatchObject({
      PK: "LOGS",
      SK: `${REVIEWED_AT}#card-1#review_id_123456`,
      clientReviewId: "review_id_123456",
      cardId: "card-1",
      rating: Rating.Good,
    });
    expect(writes[1].Put.ConditionExpression).toBe("attribute_not_exists(#pk)");
    expect(writes[2].Put.Item).toEqual({
      PK: "REVIEW_REQUESTS",
      SK: "review_id_123456",
      clientReviewId: "review_id_123456",
      cardId: "card-1",
      deckId: "deck-1",
      rating: Rating.Good,
      reviewedAt: REVIEWED_AT,
    });
    expect(writes[3].Update.UpdateExpression).toContain("ADD #reviewCount :one");
    expect(writes[4].ConditionCheck).toMatchObject({
      Key: { PK: "DECKS", SK: "DECK#deck-1" },
      ConditionExpression: "attribute_exists(#pk) AND attribute_not_exists(#deletingAt)",
    });
  });

  it("recognizes a receipt after a canceled retry as an already committed review", async () => {
    const canceled = new Error("transaction canceled");
    canceled.name = "TransactionCanceledException";
    const receipt = {
      clientReviewId: "review_id_123456",
      cardId: "card-1",
      deckId: "deck-1",
      rating: Rating.Hard,
      reviewedAt: REVIEWED_AT,
    };
    awsMocks.send
      .mockResolvedValueOnce({ Item: { PK: "META", SK: "STATS", reviewCount: 8 } })
      .mockRejectedValueOnce(canceled)
      .mockResolvedValueOnce({ Item: receipt });
    const db = await loadDb();
    const original = card();
    const { fsrs, log } = applyRating(
      original.fsrs,
      Rating.Hard,
      new Date(REVIEWED_AT)
    );

    const result = await db.commitReview({
      ...receipt,
      card: { ...original, fsrs },
      expectedVersion: null,
      log,
    });

    expect(result).toEqual({ status: "duplicate", receipt });
    expect(awsMocks.send.mock.calls[2][0].input.ConsistentRead).toBe(true);
  });

  it("backfills the aggregate once and then reads it consistently", async () => {
    awsMocks.send
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Count: 158 })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Item: { reviewCount: 158 } });
    const db = await loadDb();

    await expect(db.countReviewLogs()).resolves.toBe(158);

    expect(awsMocks.send.mock.calls[1][0].input).toMatchObject({
      Select: "COUNT",
      ConsistentRead: true,
    });
    expect(awsMocks.send.mock.calls[2][0].input.UpdateExpression).toContain(
      "if_not_exists(#reviewCount, :count)"
    );
    expect(awsMocks.send.mock.calls[3][0].input.ConsistentRead).toBe(true);
  });
});

describe("all-card queries", () => {
  it("queries deck partitions with at most four workers and never scans", async () => {
    let active = 0;
    let maxActive = 0;
    awsMocks.send.mockImplementation(
      (command: { input: { ExpressionAttributeValues: Record<string, string> } }) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        const partition = command.input.ExpressionAttributeValues[":pk"];
        const deckId = partition.slice("DECK#".length);
        return new Promise((resolve) => {
          setTimeout(() => {
            active -= 1;
            resolve({
              Items: [
                {
                  PK: partition,
                  SK: `CARD#card-${deckId}`,
                  front: deckId,
                  back: deckId,
                  createdAt: REVIEWED_AT,
                  updatedAt: REVIEWED_AT,
                  fsrs: emptyCardState(new Date(REVIEWED_AT)),
                },
              ],
            });
          }, 5);
        });
      }
    );
    const db = await loadDb();
    const decks = Array.from({ length: 6 }, (_, index) => ({ id: `deck-${index}` }));

    const cards = await db.listAllCards(decks);

    expect(cards).toHaveLength(6);
    expect(maxActive).toBe(4);
    expect(awsMocks.send).toHaveBeenCalledTimes(6);
    expect(
      awsMocks.send.mock.calls.some((call) => call[0].constructor.name === "ScanCommand")
    ).toBe(false);
  });
});

describe("deck deletion", () => {
  it("retries only unprocessed card deletes before deleting the deck record", async () => {
    const items = Array.from({ length: 26 }, (_, index) => ({
      PK: "DECK#deck-1",
      SK: `CARD#card-${index}`,
      front: `front-${index}`,
      back: `back-${index}`,
      createdAt: REVIEWED_AT,
      updatedAt: REVIEWED_AT,
      fsrs: emptyCardState(new Date(REVIEWED_AT)),
    }));
    const unprocessed = { DeleteRequest: { Key: { PK: "DECK#deck-1", SK: "CARD#card-0" } } };
    awsMocks.send
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Items: items })
      .mockResolvedValueOnce({ UnprocessedItems: { "test-table": [unprocessed] } })
      .mockResolvedValueOnce({ UnprocessedItems: {} })
      .mockResolvedValueOnce({ UnprocessedItems: {} })
      .mockResolvedValueOnce({});
    const db = await loadDb();

    await db.deleteDeck("deck-1");

    expect(awsMocks.send.mock.calls[0][0].input.UpdateExpression).toContain("#deletingAt");
    expect(awsMocks.send.mock.calls[1][0].input.ConsistentRead).toBe(true);
    expect(awsMocks.send.mock.calls[3][0].input.RequestItems["test-table"]).toEqual([
      unprocessed,
    ]);
    const finalCommand = awsMocks.send.mock.calls[5][0];
    expect(finalCommand.input.Key).toEqual({ PK: "DECKS", SK: "DECK#deck-1" });
    expect(finalCommand.input.ConditionExpression).toContain("#deletingAt");
    for (const call of awsMocks.send.mock.calls.slice(2, 5)) {
      expect(call[0].input.RequestItems["test-table"]).not.toContainEqual({
        DeleteRequest: { Key: { PK: "DECKS", SK: "DECK#deck-1" } },
      });
    }
  });
});

describe("create-only card batches", () => {
  it("skips stable imported IDs after a partial-response retry", async () => {
    const canceled = new Error("transaction canceled");
    canceled.name = "TransactionCanceledException";
    const first = card();
    const second = { ...card(), id: "card-2", front: "second" };
    awsMocks.send
      .mockRejectedValueOnce(canceled)
      .mockResolvedValueOnce({ Item: { PK: "DECKS", SK: "DECK#deck-1" } })
      .mockResolvedValueOnce({ Item: { PK: "DECK#deck-1", SK: "CARD#card-1" } })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    const db = await loadDb();

    await db.batchPutCards([first, second], { skipExisting: true });

    const retry = awsMocks.send.mock.calls[4][0].input.TransactItems;
    expect(retry).toHaveLength(2);
    expect(retry[0].ConditionCheck.Key).toEqual({ PK: "DECKS", SK: "DECK#deck-1" });
    expect(retry[1].Put.Item.SK).toBe("CARD#card-2");
    expect(retry[1].Put.ConditionExpression).toBe("attribute_not_exists(#pk)");
  });
});
