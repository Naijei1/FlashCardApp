import { describe, expect, it } from "vitest";
import { emptyCardState } from "@/lib/fsrs";
import { assertMigrationTarget, planMigration, type MigrationItem } from "@/lib/migration";
import { LEGACY_OWNER_EMAIL, LEGACY_OWNER_USER_ID } from "@/lib/multi-user-model";

const now = "2026-10-23T12:00:00.000Z";
const fsrs = emptyCardState(new Date("2026-09-01T00:00:00.000Z"));

function legacyFixture(): MigrationItem[] {
  return [
    {
      PK: "DECKS",
      SK: "DECK#lesson-1",
      name: "Lesson 1",
      frontLanguage: "zh-CN",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-02T00:00:00.000Z",
    },
    {
      PK: "DECKS",
      SK: "DECK#lesson-2",
      name: "Lesson 2",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
      deletingAt: "2026-09-03T00:00:00.000Z",
    },
    {
      PK: "DECK#lesson-1",
      SK: "CARD#card-1",
      front: "你",
      back: "you",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-02T00:00:00.000Z",
      fsrs: { ...fsrs, reps: 3 },
      hard: true,
      reviewVersion: 2,
    },
    {
      PK: "DECK#lesson-1",
      SK: "CARD#card-2",
      front: "好",
      back: "good",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
      fsrs,
    },
    {
      PK: "DECK#lesson-2",
      SK: "CARD#gone",
      front: "旧",
      back: "old",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
      fsrs,
    },
    { PK: "LOGS", SK: "2026-10-22T15:00:00.000Z#card-1#abc", reviewedAt: "2026-10-22T15:00:00.000Z" },
    { PK: "LOGS", SK: "2026-10-23T15:00:00.000Z#card-1#def", reviewedAt: "2026-10-23T15:00:00.000Z" },
    { PK: "META", SK: "STATS", reviewCount: 12 },
  ];
}

describe("migration dry run", () => {
  it("refuses the production table even if a remote apply is requested", () => {
    expect(assertMigrationTarget({ tableName: "flashcards", endpoint: "http://localhost:8000" }).ok).toBe(false);
    expect(assertMigrationTarget({ tableName: "flashcards", allowRemote: true }).ok).toBe(false);
    expect(assertMigrationTarget({ tableName: "flashcards-copy", endpoint: "http://localhost:8000" }).ok).toBe(true);
    expect(assertMigrationTarget({ tableName: "flashcards-copy" }).ok).toBe(false);
  });

  it("copies every live deck to global ids and reports before and after counts", () => {
    const plan = planMigration(legacyFixture(), { now, timeZone: "America/New_York", dryRun: true });
    expect(plan.report.deletes).toBe(0);
    expect(plan.report.ownerEmail).toBe(LEGACY_OWNER_EMAIL);
    expect(plan.report.ownerUserId).toBe(LEGACY_OWNER_USER_ID);
    expect(plan.report.ownerUserId).not.toContain("@");
    expect(plan.report.before).toMatchObject({ decks: 1, cards: 2, cardsWithProgress: 2, hardMarkers: 1 });
    expect(plan.report.after).toMatchObject({ globalDecks: 1, globalCards: 2, progressItems: 2 });
    expect(plan.report.skippedDeletingDecks).toBe(1);
    expect(plan.report.backupReminder).toMatch(/Back up/);
    expect(plan.report.featureFlag).toMatch(/DATA_MODE=legacy/);

    const content = plan.puts.filter((item) => String(item.PK).startsWith("GLOBAL#DECK#"));
    const progress = plan.puts.filter((item) => String(item.SK).startsWith("PROGRESS#"));
    expect(content.map((item) => item.SK).sort()).toEqual(["CARD#card-1", "CARD#card-2"]);
    expect(content.every((item) => item.fsrs === undefined && item.hard === undefined)).toBe(true);
    expect(progress.every((item) => item.PK === `USER#${LEGACY_OWNER_USER_ID}`)).toBe(true);
    expect(progress.find((item) => item.SK === "PROGRESS#GLOBAL#lesson-1#CARD#card-1")).toMatchObject({
      hard: true,
      reviewVersion: 2,
    });
    const claim = plan.puts.find((item) => item.PK === `CLAIM#email#${LEGACY_OWNER_EMAIL}`);
    expect(claim).toMatchObject({ userId: LEGACY_OWNER_USER_ID });
    const directory = plan.puts.find((item) => item.PK === "USERS");
    expect(directory).not.toHaveProperty("fsrs");
    expect(directory).not.toHaveProperty("front");
    expect(JSON.stringify(plan.puts)).not.toContain("CARD#gone");

    const second = planMigration([...legacyFixture(), ...plan.puts], {
      now,
      timeZone: "America/New_York",
      dryRun: true,
    });
    expect(second.puts).toEqual([]);
    expect(second.report.after).toEqual(plan.report.after);
    expect(second.report.alreadyPresent).toBeGreaterThan(0);
  });
});
