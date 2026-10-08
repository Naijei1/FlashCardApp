import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api";
import { listAllCards, listDecks } from "@/lib/db";
import { buildMistakeClinicQueue } from "@/lib/mistake-clinic-queue";
import { chineseSideForDeck } from "@/lib/write";

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;

  const decks = await listDecks();
  const cards = await listAllCards(decks, { consistent: true });
  const sides = new Map(decks.map((deck) => [deck.id, chineseSideForDeck(deck)]));
  const data = buildMistakeClinicQueue(cards, (card) => sides.get(card.deckId) ?? null);
  return NextResponse.json(data, {
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}
