import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@/lib/dynamo", () => ({
  doc: { send: mocks.send },
  getDocClient: () => ({ send: mocks.send }),
  tableName: () => "test-table",
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

function canceled(reasons: string[] = ["TransactionConflict", "TransactionConflict"]): Error {
  const error = new Error("canceled");
  error.name = "TransactionCanceledException";
  Object.assign(error, {
    CancellationReasons: reasons.map((Code) => ({ Code })),
  });
  return error;
}

it("marks a claimed profile active and retries a transient claim instead of creating a user", async () => {
  const { resolveGoogleUser } = await import("@/lib/accounts");
  let claimAttempts = 0;
  const userIds = new Set<string>();
  mocks.send.mockImplementation(async (command: { input: Record<string, unknown> }) => {
    const key = command.input.Key as { PK?: string; SK?: string } | undefined;
    if (key?.PK === "AUTH#google#sub-1") return {};
    if (key?.PK === "CLAIM#email#study@example.com") {
      return { Item: { userId: "user_legacy_owner" } };
    }
    if (command.input.TransactItems) {
      claimAttempts += 1;
      if (claimAttempts === 1) throw canceled();
      const items = JSON.stringify(command.input.TransactItems);
      expect(items).toContain("user_legacy_owner");
      return {};
    }
    if (typeof command.input.UpdateExpression === "string") {
      expect(command.input.UpdateExpression).toContain("#status");
      expect(JSON.stringify(command.input.ExpressionAttributeValues)).toContain("active");
      const profileKey = command.input.Key as { PK?: string };
      if (profileKey.PK?.startsWith("USER#")) userIds.add(profileKey.PK);
      return {};
    }
    return {};
  });

  const linked = await resolveGoogleUser({
    sub: "sub-1",
    email: "study@example.com",
    emailVerified: true,
  });
  expect(linked).toEqual({ userId: "user_legacy_owner", email: "study@example.com", role: "user" });
  expect(claimAttempts).toBe(2);
  expect(userIds.has("USER#user_legacy_owner")).toBe(true);
  expect([...userIds].some((id) => id.startsWith("USER#user_") && id !== "USER#user_legacy_owner")).toBe(false);
});

it("repairs an empty account onto an unclaimed legacy user", async () => {
  const { resolveGoogleUser } = await import("@/lib/accounts");
  const writes: string[] = [];
  mocks.send.mockImplementation(async (command: { input: Record<string, unknown> }) => {
    const key = command.input.Key as { PK?: string; SK?: string } | undefined;
    if (key?.PK === "AUTH#google#sub-1") return { Item: { userId: "user_empty" } };
    if (key?.PK === "CLAIM#email#study@example.com") return { Item: { userId: "user_legacy_owner" } };
    if (key?.PK === "USERS") return { Item: { reviewCount: 0, cardsStudied: 0 } };
    if (typeof command.input.KeyConditionExpression === "string") return { Count: 0, Items: [] };
    if (command.input.TransactItems) {
      writes.push(JSON.stringify(command.input.TransactItems));
      return {};
    }
    return {};
  });
  const linked = await resolveGoogleUser({
    sub: "sub-1",
    email: "study@example.com",
    emailVerified: true,
  });
  expect(linked.userId).toBe("user_legacy_owner");
  expect(writes.join("\n")).toContain("user_legacy_owner");
  expect(writes.join("\n")).toContain("user_empty");
});

it("does not move a claim onto an account that already has progress", async () => {
  const { resolveGoogleUser } = await import("@/lib/accounts");
  mocks.send.mockImplementation(async (command: { input: Record<string, unknown> }) => {
    const key = command.input.Key as { PK?: string; SK?: string } | undefined;
    if (key?.PK === "AUTH#google#sub-1") return { Item: { userId: "user_empty" } };
    if (key?.PK === "CLAIM#email#study@example.com") return { Item: { userId: "user_legacy_owner" } };
    if (key?.PK === "USERS" && key.SK === "USER#user_empty") {
      return { Item: { reviewCount: 2, cardsStudied: 1 } };
    }
    if (command.input.TransactItems) throw new Error("should not relink");
    return {};
  });
  const linked = await resolveGoogleUser({
    sub: "sub-1",
    email: "study@example.com",
    emailVerified: true,
  });
  expect(linked.userId).toBe("user_empty");
});
