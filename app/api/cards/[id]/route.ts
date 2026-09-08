import { NextResponse } from "next/server";
import { badRequest, notFound, requireAuth } from "@/lib/api";
import { deleteCard, getCard, getDeck, moveCard, putCard } from "@/lib/db";
import {
  isRecord,
  MAX_CARD_NOTES_LENGTH,
  MAX_CARD_SIDE_LENGTH,
} from "@/lib/validation";

// Cards are keyed by deck (PK) + id (SK), so deckId comes in the body/query.
type Context = { params: Promise<{ id: string }> };

function isWriteConflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "ConditionalCheckFailedException" ||
      error.name === "TransactionCanceledException")
  );
}

function writeConflict() {
  return NextResponse.json(
    { error: "This card changed in another session. Refresh and try again." },
    { status: 409 }
  );
}

export async function PATCH(request: Request, { params }: Context) {
  const denied = await requireAuth();
  if (denied) return denied;
  const { id } = await params;
  const body: unknown = await request.json().catch(() => null);
  if (!isRecord(body)) return badRequest("invalid body");
  const deckId = typeof body?.deckId === "string" ? body.deckId : "";
  if (!deckId) return badRequest("deckId is required");
  const card = await getCard(deckId, id);
  if (!card) return notFound("card not found");

  if (typeof body.front === "string") {
    const front = body.front.trim();
    if (!front) return badRequest("front cannot be empty");
    if (front.length > MAX_CARD_SIDE_LENGTH) return badRequest("front is too long");
    card.front = front;
  }
  if (typeof body.back === "string") {
    const back = body.back.trim();
    if (!back) return badRequest("back cannot be empty");
    if (back.length > MAX_CARD_SIDE_LENGTH) return badRequest("back is too long");
    card.back = back;
  }
  if ("notes" in body) {
    const notes = typeof body.notes === "string" ? body.notes.trim() : "";
    if (notes.length > MAX_CARD_NOTES_LENGTH) return badRequest("notes are too long");
    card.notes = notes || undefined;
  }
  card.updatedAt = new Date().toISOString();

  const moveToDeckId =
    typeof body.moveToDeckId === "string" && body.moveToDeckId !== deckId
      ? body.moveToDeckId
      : null;
  if (moveToDeckId) {
    if (!(await getDeck(moveToDeckId))) return notFound("target deck not found");
    try {
      const moved = await moveCard(card, moveToDeckId);
      return NextResponse.json(moved);
    } catch (error) {
      if (isWriteConflict(error)) return writeConflict();
      throw error;
    }
  }
  try {
    await putCard(card);
  } catch (error) {
    if (isWriteConflict(error)) return writeConflict();
    throw error;
  }
  return NextResponse.json(card);
}

export async function DELETE(request: Request, { params }: Context) {
  const denied = await requireAuth();
  if (denied) return denied;
  const { id } = await params;
  const deckId = new URL(request.url).searchParams.get("deckId");
  if (!deckId) return badRequest("deckId query param is required");
  await deleteCard(deckId, id);
  return NextResponse.json({ ok: true });
}
