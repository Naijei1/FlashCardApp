import { beforeEach, describe, expect, it, vi } from "vitest";
import { isReleasedToLearners, releaseWeekLabel } from "@/lib/multi-user-model";

const now = new Date("2026-10-23T12:00:00.000Z");

describe("release dates", () => {
  it("labels a week without treating the label as the gate", () => {
    expect(releaseWeekLabel(4)).toBe("week 4");
  });

  it("hides drafts and future schedules, and shows published and past schedules", () => {
    expect(isReleasedToLearners({ status: "draft" }, now)).toBe(false);
    expect(
      isReleasedToLearners({ status: "scheduled", releaseAt: "2026-11-01T00:00:00.000Z" }, now)
    ).toBe(false);
    expect(
      isReleasedToLearners({ status: "scheduled", releaseAt: "2026-10-01T00:00:00.000Z" }, now)
    ).toBe(true);
    expect(
      isReleasedToLearners({ status: "published", releaseAt: "2026-12-01T00:00:00.000Z" }, now)
    ).toBe(true);
    expect(isReleasedToLearners({}, now)).toBe(true);
    expect(isReleasedToLearners({ status: "published", archivedAt: "2026-10-01T00:00:00.000Z" }, now)).toBe(false);
    expect(isReleasedToLearners({ source: "private", status: "draft" }, now)).toBe(true);
  });
});

const mocks = vi.hoisted(() => ({ send: vi.fn(), session: vi.fn() }));
vi.mock("@/lib/dynamo", () => ({
  doc: { send: mocks.send },
  getDocClient: () => ({ send: mocks.send }),
  tableName: () => "test-table",
}));
vi.mock("@/lib/app-session", () => ({ getAppSession: mocks.session }));

describe("learner reads honor the release date", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function deck(status: string, releaseAt: string) {
    return {
      PK: "GLOBAL#DECKS",
      SK: "DECK#week-4",
      name: "Week 4",
      source: "global",
      status,
      releaseAt,
      releaseWeek: 4,
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
    };
  }

  async function listed() {
    mocks.send.mockImplementation(async (command: { input: { ExpressionAttributeValues?: Record<string, string> } }) => {
      const pk = command.input.ExpressionAttributeValues?.[":pk"];
      if (pk === "GLOBAL#DECKS") return { Items: [deck("scheduled", "2026-12-01T00:00:00.000Z")] };
      return { Items: [] };
    });
    const { listDecksForCurrentUser } = await import("@/lib/multi-user-store");
    return listDecksForCurrentUser();
  }

  it("hides a future week from learners and shows it to the admin", async () => {
    mocks.session.mockResolvedValue({
      userId: "user-a",
      email: "learner@example.com",
      role: "user",
      emailVerified: true,
      authMode: "google",
    });
    expect(await listed()).toEqual([]);

    mocks.session.mockResolvedValue({
      userId: "admin-1",
      email: "admin@example.com",
      role: "admin",
      emailVerified: true,
      authMode: "google",
    });
    const visibleToAdmin = await listed();
    expect(visibleToAdmin.map((deck) => deck.id)).toEqual(["week-4"]);
  });
});
