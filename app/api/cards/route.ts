import { NextResponse } from "next/server";
import { badRequest, notFound, requireAuth } from "@/lib/api";
import { buildCards } from "@/lib/cards";
import { batchPutCards, getDeck } from "@/lib/db";
import {
  isRecord,
  MAX_CARD_NOTES_LENGTH,
  MAX_CARD_SIDE_LENGTH,
} from "@/lib/validation";

export async function POST(request: Request) {
  const denied = await requireAuth();
  if (denied) return denied;
  const body: unknown = await request.json().catch(() => null);
  if (!isRecord(body)) return badRequest("invalid body");
  const deckId = typeof body?.deckId === "string" ? body.deckId : "";
  const front = typeof body?.front === "string" ? body.front.trim() : "";
  const back = typeof body?.back === "string" ? body.back.trim() : "";
  if (!deckId || !front || !back) {
    return badRequest("deckId, front, and back are required");
  }
  if (front.length > MAX_CARD_SIDE_LENGTH || back.length > MAX_CARD_SIDE_LENGTH) {
    return badRequest("card text is too long");
  }
  const notes = typeof body.notes === "string" ? body.notes.trim() : "";
  if (notes.length > MAX_CARD_NOTES_LENGTH) return badRequest("card notes are too long");
  if (!(await getDeck(deckId))) return notFound("deck not found");

  const cards = buildCards(
    {
      deckId,
      front,
      back,
      notes: notes || undefined,
      reverse: body.reverse === true,
    },
    new Date()
  );
  try {
    await batchPutCards(cards);
  } catch (error) {
    if (error instanceof Error && error.name === "DeckUnavailableError") {
      return NextResponse.json(
        { error: "This deck is being deleted. Refresh and try again." },
        { status: 409 }
      );
    }
    throw error;
  }
  return NextResponse.json(cards, { status: 201 });
}
