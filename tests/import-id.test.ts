import { describe, expect, it } from "vitest";
import { importedCardId } from "@/lib/import-id";

describe("importedCardId", () => {
  it("is stable for retries and unique per row and direction", () => {
    const first = importedCardId("import-attempt-1", 3, 0);
    expect(importedCardId("import-attempt-1", 3, 0)).toBe(first);
    expect(importedCardId("import-attempt-1", 3, 1)).not.toBe(first);
    expect(importedCardId("import-attempt-1", 4, 0)).not.toBe(first);
    expect(first).toMatch(/^[a-f0-9-]{36}$/);
  });
});
