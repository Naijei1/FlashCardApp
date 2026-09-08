import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { badRequest, notFound, requireAuth } from "@/lib/api";
import { buildCards } from "@/lib/cards";
import { batchPutCards, getDeck } from "@/lib/db";
import type { Card } from "@/lib/types";
import {
  isRecord,
  MAX_CARD_NOTES_LENGTH,
  MAX_CARD_SIDE_LENGTH,
} from "@/lib/validation";
import { importedCardId } from "@/lib/import-id";

type ImportRow = { front: string; back: string; notes?: string; reverse?: boolean };
const MAX_IMPORT_ROWS = 2_000;
const MAX_IMPORT_BYTES = 8 * 1024 * 1024;

export async function POST(request: Request) {
  const denied = await requireAuth();
  if (denied) return denied;
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_IMPORT_BYTES) {
    return NextResponse.json(
      { error: "import payload is too large" },
      { status: 413 }
    );
  }
  const body: unknown = await request.json().catch(() => null);
  if (!isRecord(body)) return badRequest("invalid body");
  const deckId = typeof body?.deckId === "string" ? body.deckId : "";
  if (!deckId || !Array.isArray(body.rows) || body.rows.length === 0) {
    return badRequest("deckId and a non-empty rows array are required");
  }
  if (body.rows.length > MAX_IMPORT_ROWS) {
    return badRequest(`imports are limited to ${MAX_IMPORT_ROWS} rows`);
  }
  if (!body.rows.every(isRecord)) return badRequest("every import row must be an object");
  const rows: ImportRow[] = body.rows.map((row) => ({
    front: typeof row.front === "string" ? row.front : "",
    back: typeof row.back === "string" ? row.back : "",
    ...(typeof row.notes === "string" ? { notes: row.notes } : {}),
    ...(typeof row.reverse === "boolean" ? { reverse: row.reverse } : {}),
  }));
  const reverseAll = body?.reverse === true;
  const requestedImportId = typeof body?.importId === "string" ? body.importId : "";
  const importId = /^[\w-]{8,128}$/.test(requestedImportId)
    ? requestedImportId
    : randomUUID();
  if (
    rows.some(
      (row) =>
        row.front.trim().length > MAX_CARD_SIDE_LENGTH ||
        row.back.trim().length > MAX_CARD_SIDE_LENGTH ||
        (row.notes?.trim().length ?? 0) > MAX_CARD_NOTES_LENGTH
    )
  ) {
    return badRequest("one or more imported fields are too long");
  }
  if (!(await getDeck(deckId))) return notFound("deck not found");

  const now = new Date();
  const cards: Card[] = [];
  rows.forEach((row, rowIndex) => {
    const front = typeof row.front === "string" ? row.front.trim() : "";
    const back = typeof row.back === "string" ? row.back.trim() : "";
    if (!front || !back) return;
    const notes = typeof row.notes === "string" ? row.notes.trim() : "";
    let cardIndex = 0;
    cards.push(
      ...buildCards(
        {
          deckId,
          front,
          back,
          notes: notes || undefined,
          // A per-row reverse column overrides the import-wide toggle.
          reverse: typeof row.reverse === "boolean" ? row.reverse : reverseAll,
        },
        now,
        () => importedCardId(importId, rowIndex, cardIndex++)
      )
    );
  });
  if (cards.length === 0) return badRequest("no valid cards to import");
  try {
    await batchPutCards(cards, { skipExisting: true });
  } catch (error) {
    if (error instanceof Error && error.name === "DeckUnavailableError") {
      return NextResponse.json(
        { error: "This deck is being deleted. Refresh and try again." },
        { status: 409 }
      );
    }
    throw error;
  }
  return NextResponse.json({ created: cards.length, importId }, { status: 201 });
}
