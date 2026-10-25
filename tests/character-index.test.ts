import { beforeEach, expect, it, vi } from "vitest";
import { emptyCardState } from "@/lib/fsrs";

const mocks = vi.hoisted(() => ({ send: vi.fn(), session: vi.fn() }));

vi.mock("@/lib/dynamo", () => ({
  doc: { send: mocks.send },
  getDocClient: () => ({ send: mocks.send }),
  tableName: () => "test-table",
  observeDbLatency: async <T,>(_name: string, work: () => Promise<T>) => work(),
}));
vi.mock("@/lib/app-session", () => ({ getAppSession: () => mocks.session() }));

const createdAt = "2026-10-25T00:00:00.000Z";

function commandInput(call: unknown): { Key?: { PK?: string; SK?: string }; TransactItems?: unknown; RequestItems?: Record<string, unknown[]> } {
  return (call as { input: { Key?: { PK?: string; SK?: string }; TransactItems?: unknown; RequestItems?: Record<string, unknown[]> } }).input;
}

beforeEach(() => {
  vi.resetModules();
  mocks.send.mockReset();
  mocks.session.mockReset();
  process.env.TABLE_NAME = "test-table";
  process.env.DATA_MODE = "multi-user";
});

it("writes global character rows when an admin saves cards", async () => {
  mocks.session.mockResolvedValue({
    userId: "admin-1",
    email: "admin@example.com",
    role: "admin",
    emailVerified: true,
    authMode: "google",
  });
  const batches: unknown[] = [];
  mocks.send.mockImplementation(async (command: unknown) => {
    const input = commandInput([command][0] ? command : command);
    if (input.Key?.PK === "GLOBAL#DECKS") {
      return {
        Item: {
          PK: "GLOBAL#DECKS",
          SK: "DECK#deck-1",
          name: "HSK",
          source: "global",
          status: "published",
          createdAt,
          updatedAt: createdAt,
        },
      };
    }
    if (input.RequestItems) batches.push(input.RequestItems["test-table"]);
    return {};
  });
  const { batchPutCardsForCurrentUser, deleteCardForCurrentUser } = await import("@/lib/multi-user-store");
  await batchPutCardsForCurrentUser([
    {
      id: "card-1",
      deckId: "deck-1",
      front: "学习",
      back: "to study",
      createdAt,
      updatedAt: createdAt,
      fsrs: emptyCardState(new Date(createdAt)),
      source: "global",
    },
  ]);
  const puts = (batches[0] as Array<{ PutRequest?: { Item: { PK: string; SK: string; front: string } } }>).map(
    (request) => request.PutRequest?.Item
  );
  expect(puts).toEqual([
    expect.objectContaining({ PK: "CIDX#G#学", SK: "card-1", front: "学习", back: "to study" }),
    expect.objectContaining({ PK: "CIDX#G#习", SK: "card-1", front: "学习", back: "to study" }),
  ]);

  batches.length = 0;
  mocks.send.mockImplementation(async (command: unknown) => {
    const input = commandInput(command);
    if (input.Key?.PK === "GLOBAL#DECKS") {
      return {
        Item: {
          PK: "GLOBAL#DECKS",
          SK: "DECK#deck-1",
          name: "HSK",
          source: "global",
          status: "published",
          createdAt,
          updatedAt: createdAt,
        },
      };
    }
    if (input.Key?.PK === "GLOBAL#DECK#deck-1") {
      return { Item: { PK: input.Key.PK, SK: "CARD#card-1", front: "学习", back: "to study", updatedAt: createdAt } };
    }
    if (input.RequestItems) batches.push(input.RequestItems["test-table"]);
    return {};
  });
  await deleteCardForCurrentUser("deck-1", "card-1");
  const deletes = batches[0] as Array<{ DeleteRequest?: { Key: { PK: string; SK: string } } }>;
  expect(deletes.map((request) => request.DeleteRequest?.Key.PK).sort()).toEqual(["CIDX#G#习", "CIDX#G#学"]);
});

it("refreshes a private card when its Chinese side changes", async () => {
  mocks.session.mockResolvedValue({
    userId: "user-1",
    email: "learner@example.com",
    role: "user",
    emailVerified: true,
    authMode: "google",
  });
  const batches: unknown[] = [];
  mocks.send.mockImplementation(async (command: unknown) => {
    const input = commandInput(command);
    if (input.Key?.PK === "GLOBAL#DECKS") return {};
    if (input.Key?.PK === "USER#user-1#DECKS") {
      return {
        Item: {
          PK: input.Key.PK,
          SK: "DECK#deck-1",
          name: "Mine",
          source: "private",
          createdAt,
          updatedAt: createdAt,
        },
      };
    }
    if (input.Key?.SK === "CARD#card-1") {
      return { Item: { ...input.Key, front: "学生", back: "student", updatedAt: createdAt } };
    }
    if (input.RequestItems) batches.push(input.RequestItems["test-table"]);
    return {};
  });
  const { putCardForCurrentUser } = await import("@/lib/multi-user-store");
  await putCardForCurrentUser({
    id: "card-1",
    deckId: "deck-1",
    front: "学习",
    back: "to study",
    createdAt,
    updatedAt: "2026-10-25T01:00:00.000Z",
    fsrs: emptyCardState(new Date(createdAt)),
    source: "private",
  });
  const requests = batches[0] as Array<{
    DeleteRequest?: { Key: { PK: string } };
    PutRequest?: { Item: { PK: string; front: string } };
  }>;
  expect(requests.map((request) => request.DeleteRequest?.Key.PK ?? request.PutRequest?.Item.PK)).toEqual([
    "CIDX#U#user-1#生",
    "CIDX#U#user-1#学",
    "CIDX#U#user-1#习",
  ]);
  expect(requests[1].PutRequest?.Item.front).toBe("学习");
});
