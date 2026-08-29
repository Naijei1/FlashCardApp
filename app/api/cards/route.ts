import { NextResponse } from "next/server";
import { badRequest, notFound, requireAuth } from "@/lib/api";
import { buildCards } from "@/lib/cards";
import { batchPutCards, getDeck } from "@/lib/db";

export async function POST(request: Request) {
  const denied = await requireAuth();
  if (denied) return denied;
  const body = await request.json().catch(() => null);
  const deckId = typeof body?.deckId === "string" ? body.deckId : "";
  const front = typeof body?.front === "string" ? body.front.trim() : "";
  const back = typeof body?.back === "string" ? body.back.trim() : "";
  if (!deckId || !front || !back) {
    return badRequest("deckId, front, and back are required");
  }
  if (!(await getDeck(deckId))) return notFound("deck not found");

  const cards = buildCards(
    {
      deckId,
      front,
      back,
      notes: typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : undefined,
      reverse: body.reverse === true,
    },
    new Date()
  );
  await batchPutCards(cards);
  return NextResponse.json(cards, { status: 201 });
}
