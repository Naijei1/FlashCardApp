import { NextResponse } from "next/server";
import { badRequest, notFound, requireAuth } from "@/lib/api";
import { listAllCards } from "@/lib/db";
import { studyDeck, studyCards } from "@/lib/hard-words";
import { buildReviewQueueData } from "@/lib/review-queue";
import { cardForMode } from "@/lib/modes";
import { uniqueWords } from "@/lib/words";
import { isNew } from "@/lib/due";
import type { Card } from "@/lib/types";
import { chineseSideForDeck, type ChineseSide } from "@/lib/write";

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
  let deckSide: ChineseSide | null = null;
  if (deckId === "all") {
    cards = await listAllCards(undefined, { consistent: true });
  } else {
    const [deck, deckCards] = await Promise.all([
      studyDeck(deckId),
      studyCards(deckId),
    ]);
    if (!deck) return notFound("deck not found");
    deckSide = chineseSideForDeck(deck);
    if (mode === "pinyin" || mode === "write") {
      const { buildPinyinQueueData } = await import("@/lib/pinyin-queue");
      return queueResponse(buildPinyinQueueData(deckCards.map((card) => cardForMode(card, mode)), deckSide));
    }
    cards = deckCards;
  }
  cards = cards.map((card) => cardForMode(card, mode));
  if (newOnly) cards = uniqueWords(cards).filter(isNew);
  const data = buildReviewQueueData(cards);
  const { readingForCard } = await import("@/lib/pinyin-queue");
  return queueResponse({ ...data, queue: data.queue.map((item) => ({
    ...item, pinyin: readingForCard(item.card, deckSide) ?? undefined,
  })) });
}
