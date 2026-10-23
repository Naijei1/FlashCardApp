import { NextResponse } from "next/server";
import { accessErrorResponse, badRequest, notFound, requireAuth } from "@/lib/api";
import { getAppSession } from "@/lib/app-session";
import { usesMultiUserData } from "@/lib/flags";
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
  const previous = { front: card.front, back: card.back, notes: card.notes };

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
  if (usesMultiUserData() && card.source === "global") {
    const session = await getAppSession();
    if (session?.role !== "admin") {
      return NextResponse.json({ error: "admin only" }, { status: 403 });
    }
    const editKind = body.editKind;
    if (editKind !== "typo" && editKind !== "meaning") {
      return badRequest("Choose whether this is a typo fix or a meaning change");
    }
    if (editKind === "meaning") {
      if (moveToDeckId) return badRequest("A meaning change stays in this deck and creates a new card");
      try {
        const { replaceGlobalCardMeaning } = await import("@/lib/multi-user-store");
        const created = await replaceGlobalCardMeaning(
          { ...card, front: previous.front, back: previous.back, notes: previous.notes },
          { front: card.front, back: card.back, notes: card.notes }
        );
        return NextResponse.json(created);
      } catch (error) {
        const access = accessErrorResponse(error);
        if (access) return access;
        throw error;
      }
    }
  }
  if (moveToDeckId) {
    if (!(await getDeck(moveToDeckId))) return notFound("target deck not found");
    try {
      const moved = await moveCard(card, moveToDeckId);
      return NextResponse.json(moved);
    } catch (error) {
      const access = accessErrorResponse(error);
      if (access) return access;
      if (isWriteConflict(error)) return writeConflict();
      throw error;
    }
  }
  try {
    await putCard(card);
  } catch (error) {
    const access = accessErrorResponse(error);
    if (access) return access;
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
  try {
    await deleteCard(deckId, id);
  } catch (error) {
    const access = accessErrorResponse(error);
    if (access) return access;
    throw error;
  }
  return NextResponse.json({ ok: true });
}
