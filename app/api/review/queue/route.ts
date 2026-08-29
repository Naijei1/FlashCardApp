import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api";
import { listCards, scanAllCards } from "@/lib/db";
import { buildQueue } from "@/lib/due";
import { previewIntervals } from "@/lib/fsrs";

export async function GET(request: Request) {
  const denied = await requireAuth();
  if (denied) return denied;
  const deckId = new URL(request.url).searchParams.get("deckId");
  const cards =
    deckId && deckId !== "all" ? await listCards(deckId) : await scanAllCards();
  const now = new Date();
  const queue = buildQueue(cards, now).map((card) => ({
    card,
    intervals: previewIntervals(card.fsrs, now),
  }));
  return NextResponse.json({ queue });
}
