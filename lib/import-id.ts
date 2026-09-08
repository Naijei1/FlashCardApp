import { createHash } from "node:crypto";

/** Stable per import attempt so retrying a partially written batch is idempotent. */
export function importedCardId(
  importId: string,
  rowIndex: number,
  cardIndex: number
): string {
  const hex = createHash("sha256")
    .update(`${importId}:${rowIndex}:${cardIndex}`)
    .digest("hex")
    .slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
