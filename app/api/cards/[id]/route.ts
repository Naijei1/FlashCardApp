import { NextResponse } from "next/server";
import { badRequest, notFound, requireAuth } from "@/lib/api";
import { deleteCard, getCard, getDeck, moveCard, putCard } from "@/lib/db";

// Cards are keyed by deck (PK) + id (SK), so deckId comes in the body/query.
type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  const denied = await requireAuth();
  if (denied) return denied;
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const deckId = typeof body?.deckId === "string" ? body.deckId : "";
  if (!deckId) return badRequest("deckId is required");
  const card = await getCard(deckId, id);
  if (!card) return notFound("card not found");

  if (typeof body.front === "string") {
    const front = body.front.trim();
    if (!front) return badRequest("front cannot be empty");
    card.front = front;
  }
  if (typeof body.back === "string") {
    const back = body.back.trim();
    if (!back) return badRequest("back cannot be empty");
    card.back = back;
  }
  if ("notes" in body) {
    const notes = typeof body.notes === "string" ? body.notes.trim() : "";
    card.notes = notes || undefined;
  }
  card.updatedAt = new Date().toISOString();

  const moveToDeckId =
    typeof body.moveToDeckId === "string" && body.moveToDeckId !== deckId
      ? body.moveToDeckId
      : null;
  if (moveToDeckId) {
    if (!(await getDeck(moveToDeckId))) return notFound("target deck not found");
    const moved = await moveCard(card, moveToDeckId);
    return NextResponse.json(moved);
  }
  await putCard(card);
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
