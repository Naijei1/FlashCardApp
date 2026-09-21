import { NextResponse } from "next/server";
import { badRequest, notFound, requireAuth } from "@/lib/api";
import { getDeck, listAllCards, listCards } from "@/lib/db";
import { buildReviewQueueData } from "@/lib/review-queue";
import { uniqueWords } from "@/lib/words";
import { isNew } from "@/lib/due";
import type { Card } from "@/lib/types";
import { chineseSideForCard, chineseSideForDeck } from "@/lib/write";

const queueResponse = (data: unknown) => NextResponse.json(data, {
  headers: { "Cache-Control": "private, no-store, max-age=0" },
});

export async function GET(request: Request) {
  const denied = await requireAuth();
  if (denied) return denied;
  const searchParams = new URL(request.url).searchParams;
  const deckId = searchParams.get("deckId") || "all";
  const newOnly = searchParams.get("new") === "1";
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
      return queueResponse(buildPinyinQueueData(deckCards, deckSide));
    }
    cards =
      mode === "write"
        ? deckCards.filter((card) => chineseSideForCard(card, deckSide) !== null)
        : deckCards;
  }
  if (newOnly) cards = uniqueWords(cards).filter(isNew);
  return queueResponse(buildReviewQueueData(cards));
}
