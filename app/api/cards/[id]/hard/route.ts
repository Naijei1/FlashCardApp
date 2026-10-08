import { NextResponse } from "next/server";
import { badRequest, notFound, requireRegularUser } from "@/lib/api";
import { getCard, listCards, setCardHard } from "@/lib/db";
import { wordKey } from "@/lib/words";
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRegularUser(); if (auth.response) return auth.response;
  const body = await request.json().catch(() => null);
  if (typeof body?.deckId !== "string" || typeof body?.hard !== "boolean") return badRequest("deckId and hard are required");
  const { id } = await params;
  const card = await getCard(body.deckId, id, auth.session); if (!card) return notFound("card not found");
  // Mark/unmark reverse copies together, so the selected copy cannot hide a marker.
  const copies = (await listCards(body.deckId, { consistent: true, session: auth.session })).filter((c) => wordKey(c) === wordKey(card));
  await Promise.all(copies.map((c) => setCardHard(c.deckId, c.id, body.hard, auth.session)));
  return NextResponse.json({ ok: true, hard: body.hard });
}
