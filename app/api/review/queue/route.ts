import { NextResponse } from "next/server";
import { badRequest, notFound, requireAuth } from "@/lib/api";
import { getDeck, listAllCards, listCards } from "@/lib/db";
import { buildReviewQueueData } from "@/lib/review-queue";
import type { Card } from "@/lib/types";
import { chineseSideForCard, chineseSideForDeck } from "@/lib/write";

export async function GET(request: Request) {
  const denied = await requireAuth();
  if (denied) return denied;
  const searchParams = new URL(request.url).searchParams;
  const deckId = searchParams.get("deckId") || "all";
  const mode = searchParams.get("mode") || "review";
  if (mode !== "review" && mode !== "write" && mode !== "pinyin") return badRequest("unsupported mode");
  if (mode !== "review" && deckId === "all") {
    return badRequest(`${mode} mode requires a deck`);
  }

  let cards: Card[];
  if (deckId === "all") {
    cards = await listAllCards(undefined, { consistent: true });
  } else {
    const [deck, deckCards] = await Promise.all([
      getDeck(deckId),
      listCards(deckId, { consistent: true }),
    ]);
    if (!deck) return notFound("deck not found");
    const deckSide = chineseSideForDeck(deck);
    if (mode === "pinyin") {
      const { buildPinyinQueueData } = await import("@/lib/pinyin-queue");
      return NextResponse.json(buildPinyinQueueData(deckCards, deckSide));
    }
    cards =
      mode === "write"
        ? deckCards.filter((card) => chineseSideForCard(card, deckSide) !== null)
        : deckCards;
  }
  return NextResponse.json(buildReviewQueueData(cards));
}
