export const MAX_DECK_NAME_LENGTH = 200;
export const MAX_CARD_SIDE_LENGTH = 10_000;
export const MAX_CARD_NOTES_LENGTH = 50_000;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
