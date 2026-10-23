import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { badRequest, requireAdmin } from "@/lib/api";
import { buildCards } from "@/lib/cards";
import { batchPutCards, putDeck } from "@/lib/db";
import { usesMultiUserData } from "@/lib/flags";
import type { Deck } from "@/lib/types";
import { isRecord, MAX_CARD_NOTES_LENGTH, MAX_CARD_SIDE_LENGTH, MAX_DECK_NAME_LENGTH } from "@/lib/validation";

export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  if (!usesMultiUserData()) {
    return NextResponse.json(
      { error: "Set DATA_MODE=multi-user after migration before saving a draft" },
      { status: 409 }
    );
  }
  const body: unknown = await request.json().catch(() => null);
  if (!isRecord(body) || !Array.isArray(body.rows)) return badRequest("rows are required");
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return badRequest("deck name is required");
  if (name.length > MAX_DECK_NAME_LENGTH) return badRequest("deck name is too long");
  if (body.rows.length === 0 || body.rows.length > 2000) return badRequest("imports are limited to 2000 rows");
  if (!body.rows.every(isRecord)) return badRequest("every import row must be an object");
  const now = new Date();
  const deck: Deck = {
    id: randomUUID(),
    name,
    frontLanguage: "zh-CN",
    backLanguage: "en-US",
    chineseSide: "front",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    source: "global",
    status: "draft",
  };
  const cards = body.rows.flatMap((row) => {
    const front = typeof row.front === "string" ? row.front.trim() : "";
    const back = typeof row.back === "string" ? row.back.trim() : "";
    const notes = typeof row.notes === "string" ? row.notes.trim() : "";
    if (!front || !back) return [];
    if (front.length > MAX_CARD_SIDE_LENGTH || back.length > MAX_CARD_SIDE_LENGTH || notes.length > MAX_CARD_NOTES_LENGTH) {
      return [];
    }
    return buildCards({ deckId: deck.id, front, back, notes: notes || undefined }, now);
  });
  if (cards.length === 0) return badRequest("no valid cards to save");
  await putDeck(deck, { create: true });
  await batchPutCards(cards.map((card) => ({ ...card, source: "global" as const })));
  return NextResponse.json({ deckId: deck.id, name: deck.name, created: cards.length, status: "draft" }, { status: 201 });
}
