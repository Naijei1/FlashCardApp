import { NextResponse } from "next/server";
import { badRequest, notFound, requireAuth } from "@/lib/api";
import { getCard, putCard, putReviewLog } from "@/lib/db";
import { applyRating, previewIntervals, Rating, type Grade } from "@/lib/fsrs";

const GRADES: number[] = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy];

export async function POST(request: Request) {
  const denied = await requireAuth();
  if (denied) return denied;
  const body = await request.json().catch(() => null);
  const cardId = typeof body?.cardId === "string" ? body.cardId : "";
  const deckId = typeof body?.deckId === "string" ? body.deckId : "";
  const rating = Number(body?.rating);
  if (!cardId || !deckId || !GRADES.includes(rating)) {
    return badRequest("cardId, deckId, and rating (1-4) are required");
  }
  const card = await getCard(deckId, cardId);
  if (!card) return notFound("card not found");

  const now = new Date();
  const { fsrs, log } = applyRating(card.fsrs, rating as Grade, now);
  card.fsrs = fsrs;
  card.updatedAt = now.toISOString();
  await putCard(card);
  await putReviewLog(card.id, log);
  return NextResponse.json({
    card,
    intervals: previewIntervals(fsrs, new Date(fsrs.due)),
  });
}
