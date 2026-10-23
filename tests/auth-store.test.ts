import { beforeEach, describe, expect, it, vi } from "vitest";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";

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

beforeEach(() => {
  vi.resetModules();
  awsMocks.send.mockReset();
  delete (globalThis as typeof globalThis & { __ddb?: unknown }).__ddb;
  process.env.TABLE_NAME = "test-table";
  process.env.SESSION_SECRET = "a".repeat(64);
});

describe("DynamoDB auth rows", () => {
  it("stores login attempts with a TTL and an optimistic lock", async () => {
    awsMocks.send.mockResolvedValueOnce({});
    const { dynamoLoginStore } = await import("@/lib/auth-store");
    const saved = await dynamoLoginStore.save(
      "hashed-key",
      { failures: 6, windowStartedAt: 1_000, blockedUntil: 3_000 },
      { failures: 5, windowStartedAt: 1_000, blockedUntil: 0 }
    );
    expect(saved).toBe(true);
    const command = awsMocks.send.mock.calls[0][0];
    expect(command).toBeInstanceOf(UpdateCommand);
    expect(command.input.Key).toEqual({ PK: "AUTH#LOGIN", SK: "ATTEMPT#hashed-key" });
    expect(command.input.ConditionExpression).toContain("failures = :oldFailures");
    expect(command.input.ExpressionAttributeValues[":ttl"]).toBeGreaterThan(1);
    expect(command.input.ExpressionAttributeNames["#ttl"]).toBe("ttl");
  });

  it("treats a missing or revoked session row as logged out", async () => {
    awsMocks.send
      .mockResolvedValueOnce({ Item: { sessionVersion: 2 } })
      .mockResolvedValueOnce({ Item: { expiresAt: "2026-11-01T00:00:00.000Z" } });
    const { sessionIsCurrent } = await import("@/lib/auth-store");
    expect(
      await sessionIsCurrent("shared", "session-id-123456", 2, Date.parse("2026-10-23T00:00:00Z"))
    ).toBe(true);

    awsMocks.send.mockReset();
    awsMocks.send
      .mockResolvedValueOnce({ Item: { sessionVersion: 3 } })
      .mockResolvedValueOnce({ Item: { expiresAt: "2026-11-01T00:00:00.000Z" } });
    expect(
      await sessionIsCurrent("shared", "session-id-123456", 2, Date.parse("2026-10-23T00:00:00Z"))
    ).toBe(false);

    awsMocks.send.mockReset();
    awsMocks.send
      .mockResolvedValueOnce({ Item: { sessionVersion: 2 } })
      .mockResolvedValueOnce({});
    expect(
      await sessionIsCurrent("shared", "session-id-123456", 2, Date.parse("2026-10-23T00:00:00Z"))
    ).toBe(false);
  });

  it("log out everywhere adds one to that user's session version", async () => {
    awsMocks.send.mockResolvedValueOnce({});
    const { revokeAllSessions } = await import("@/lib/auth-store");
    await revokeAllSessions("shared", Date.parse("2026-10-23T00:00:00Z"));
    const command = awsMocks.send.mock.calls[0][0];
    expect(command.input.Key).toEqual({ PK: "USER#shared", SK: "AUTH" });
    expect(command.input.UpdateExpression).toContain("ADD sessionVersion :one");
    expect(command.input.ExpressionAttributeValues[":one"]).toBe(1);
  });
});
