import { describe, expect, it } from "vitest";
import {
  assertSafeMigrationTarget,
  migrateMultiUser,
  validateDeckClassification,
  MigrationError,
} from "@/lib/migration";

const config = {
  naijeiUserId: "naijei-sub",
  adminUserId: "admin-sub",
  decks: { "deck-1": "global" as const },
};

describe("migration safety checks", () => {
  it("fails when any existing deck is unclassified or the config names an unknown deck", () => {
    expect(() => validateDeckClassification(["deck-1", "secret"], { "deck-1": "global" })).toThrow(
      MigrationError
    );
    expect(() => validateDeckClassification(["deck-1", "secret"], { "deck-1": "global" })).toThrow(
      /secret/
    );
    expect(() => validateDeckClassification(["deck-1"], { "deck-1": "global", extra: "private" })).toThrow(
      /extra/
    );
    expect(() => validateDeckClassification(["deck-1"], { "deck-1": "global" })).not.toThrow();
  });

  it("refuses the production table and real AWS before opening a connection", async () => {
    expect(() => assertSafeMigrationTarget("flashcards", "http://127.0.0.1:8000")).toThrow(
      /production table/
    );
    await expect(
      migrateMultiUser({
        tableName: "flashcards",
        endpoint: "http://127.0.0.1:9",
        config,
      })
    ).rejects.toThrow(/production table/);
    await expect(migrateMultiUser({ tableName: "flashcards-copy", config })).rejects.toThrow(
      /DYNAMODB_ENDPOINT/
    );
    await expect(
      migrateMultiUser({
        tableName: "flashcards-copy",
        endpoint: "https://dynamodb.us-east-1.amazonaws.com",
        config,
      })
    ).rejects.toThrow(/AWS DynamoDB endpoint/);
  });
});
