import { expect, it } from "vitest";
import { planGlobalEdit } from "@/lib/multi-user-model";

it("requires a typo or meaning choice and keeps progress only for typos", () => {
  expect(planGlobalEdit({ editKind: "", cardId: "card-1", now: "2026-10-23T00:00:00.000Z", newId: "card-2" })).toEqual({
    error: "Choose whether this is a typo fix or a meaning change",
  });
  expect(
    planGlobalEdit({ editKind: "typo", cardId: "card-1", now: "2026-10-23T00:00:00.000Z", newId: "card-2", contentVersion: 4 })
  ).toEqual({ kind: "typo", id: "card-1", contentVersion: 5 });
  expect(
    planGlobalEdit({ editKind: "meaning", cardId: "card-1", now: "2026-10-23T00:00:00.000Z", newId: "card-2" })
  ).toEqual({ kind: "meaning", archivedId: "card-1", createdId: "card-2", archivedAt: "2026-10-23T00:00:00.000Z" });
});
