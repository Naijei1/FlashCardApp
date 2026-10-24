import { beforeEach, expect, it, vi } from "vitest";
import { nextScheduledTeaser, partitionStudyDecks, toAdminUserSummary } from "@/lib/multi-user-model";

it("keeps a single deck list until a deck is marked shared or private", () => {
  expect(partitionStudyDecks([{ source: undefined }, { source: null }])).toBeNull();
  expect(
    partitionStudyDecks([
      { id: "g", source: "global" },
      { id: "p", source: "private" },
      { id: "legacy" },
    ])
  ).toEqual({
    shared: [
      { id: "g", source: "global" },
      { id: "legacy" },
    ],
    personal: [{ id: "p", source: "private" }],
  });
});

it("teases the soonest future scheduled deck without card fields", () => {
  const now = new Date("2026-10-01T00:00:00.000Z");
  const teaser = nextScheduledTeaser(
    [
      { name: "Later", status: "scheduled", releaseAt: "2026-12-01T00:00:00.000Z", source: "global" },
      {
        name: "Soon",
        status: "scheduled",
        releaseAt: "2026-11-01T00:00:00.000Z",
        releaseWeek: 3,
        source: "global",
      },
      { name: "Past", status: "scheduled", releaseAt: "2026-09-01T00:00:00.000Z", source: "global" },
      { name: "Mine", status: "scheduled", releaseAt: "2026-10-02T00:00:00.000Z", source: "private" },
      { name: "Live", status: "published", releaseAt: "2026-10-15T00:00:00.000Z", source: "global" },
      {
        name: "Archived",
        status: "scheduled",
        releaseAt: "2026-10-05T00:00:00.000Z",
        archivedAt: "2026-10-01T00:00:00.000Z",
        source: "global",
      },
    ],
    now
  );
  expect(teaser).toEqual({
    name: "Soon",
    releaseAt: "2026-11-01T00:00:00.000Z",
    releaseWeek: 3,
  });
  expect(teaser && Object.keys(teaser).sort()).toEqual(["name", "releaseAt", "releaseWeek"]);
  expect(nextScheduledTeaser([], now)).toBeNull();
});

it("adds disabled to the admin summary allowlist and leaves other statuses off", () => {
  const base = {
    userId: "user-a",
    email: "a@example.com",
    role: "user",
    cardsStudied: 1,
    reviewCount: 2,
    currentStreak: 0,
    front: "你",
  };
  expect(toAdminUserSummary({ ...base, status: "disabled" }).status).toBe("disabled");
  expect(toAdminUserSummary({ ...base, status: "active" }).status).toBeUndefined();
  expect(JSON.stringify(toAdminUserSummary({ ...base, status: "disabled" }))).not.toContain("你");
});

const mocks = vi.hoisted(() => ({ send: vi.fn(), session: vi.fn() }));
vi.mock("@/lib/dynamo", () => ({
  doc: { send: mocks.send },
  getDocClient: () => ({ send: mocks.send }),
  tableName: () => "test-table",
}));
vi.mock("@/lib/app-session", () => ({ getAppSession: mocks.session }));

const admin = {
  userId: "admin-1",
  email: "admin@example.com",
  role: "admin" as const,
  emailVerified: true,
  authMode: "google" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
});

it("marks a learner disabled on the profile and directory and leaves progress alone", async () => {
  const { setLearnerDisabled } = await import("@/lib/multi-user-store");
  mocks.session.mockResolvedValue(admin);
  const writes: string[] = [];
  mocks.send.mockImplementation(async (command: { input: Record<string, unknown> }) => {
    const key = command.input.Key as { PK?: string; SK?: string } | undefined;
    if (!command.input.UpdateExpression) {
      if (key?.SK === "PROFILE") return { Item: { role: "user", status: "active" } };
      if (key?.PK === "USERS") return { Item: { role: "user", reviewCount: 4 } };
      return {};
    }
    writes.push(JSON.stringify(command.input));
    return {};
  });
  await setLearnerDisabled("user-1", true);
  expect(writes).toHaveLength(2);
  const saved = writes.join("\n");
  expect(saved).toContain("disabled");
  expect(saved).toContain("PROFILE");
  expect(saved).toContain("USER#user-1");
  expect(saved).not.toContain("PROGRESS");
  expect(saved).not.toContain("reviewCount");
});

it("refuses to disable an admin or the signed-in account", async () => {
  const { setLearnerDisabled } = await import("@/lib/multi-user-store");
  mocks.session.mockResolvedValue(admin);
  await expect(setLearnerDisabled("admin-1", true)).rejects.toThrow(/own account/);
  expect(mocks.send).not.toHaveBeenCalled();

  mocks.send.mockImplementation(async (command: { input: Record<string, unknown> }) => {
    const key = command.input.Key as { SK?: string; PK?: string } | undefined;
    if (command.input.UpdateExpression) throw new Error("should not write");
    if (key?.SK === "PROFILE") return { Item: { role: "admin" } };
    if (key?.PK === "USERS") return { Item: { role: "user" } };
    return {};
  });
  await expect(setLearnerDisabled("user-admin", true)).rejects.toThrow(/cannot be disabled/);
});

it("returns the next release name for a learner and nothing for an admin", async () => {
  const { nextReleaseTeaserForCurrentUser } = await import("@/lib/multi-user-store");
  mocks.session.mockResolvedValue(admin);
  expect(await nextReleaseTeaserForCurrentUser()).toBeNull();
  expect(mocks.send).not.toHaveBeenCalled();

  mocks.session.mockResolvedValue({ ...admin, userId: "user-1", role: "user" });
  mocks.send.mockImplementation(async (command: { input: Record<string, unknown> }) => {
    expect(JSON.stringify(command.input.ExpressionAttributeValues)).toContain("GLOBAL#DECKS");
    return {
      Items: [
        {
          PK: "GLOBAL#DECKS",
          SK: "DECK#week-2",
          name: "Week 2",
          status: "scheduled",
          releaseAt: "2099-01-01T00:00:00.000Z",
          releaseWeek: 2,
          front: "secret front",
          back: "secret back",
        },
        { PK: "GLOBAL#DECKS", SK: "CARD#nope", front: "card", back: "text" },
      ],
    };
  });
  const teaser = await nextReleaseTeaserForCurrentUser();
  expect(teaser).toEqual({
    name: "Week 2",
    releaseAt: "2099-01-01T00:00:00.000Z",
    releaseWeek: 2,
  });
  expect(JSON.stringify(teaser)).not.toMatch(/secret|card|text/);
});
