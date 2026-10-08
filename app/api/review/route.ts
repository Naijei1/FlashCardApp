import { NextResponse } from "next/server";
import { badRequest, notFound, requireRegularUser } from "@/lib/api";
import {
  commitReview,
  getDeck,
  getCardForReview,
  getReviewReceipt,
  reviewReceiptsMatch,
  type ReviewReceipt,
} from "@/lib/db";
import { cardForMode, rateMode } from "@/lib/modes";
import type { ReviewMode } from "@/lib/types";
import { Rating, type Grade } from "@/lib/fsrs";

const GRADES: number[] = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy];
const CLIENT_REVIEW_ID = /^[A-Za-z0-9_-]{12,100}$/;
const MAX_WRITE_ATTEMPTS = 5;
const MAX_CLOCK_SKEW_MS = 5 * 60_000;

function conflict(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 409 });
}

export async function POST(request: Request) {
  const auth = await requireRegularUser();
  if (auth.response) return auth.response;
  const { session } = auth;
  const body = await request.json().catch(() => null);
  const cardId = typeof body?.cardId === "string" ? body.cardId : "";
  const deckId = typeof body?.deckId === "string" ? body.deckId : "";
  const clientReviewId =
    typeof body?.clientReviewId === "string" ? body.clientReviewId : "";
  const mode: ReviewMode = body?.mode ?? "review";
  if (!["review", "write", "pinyin"].includes(mode)) return badRequest("unsupported mode");
  const rating = Number(body?.rating);
  const reviewedAt =
    typeof body?.reviewedAt === "string" && Number.isFinite(Date.parse(body.reviewedAt))
      ? new Date(body.reviewedAt).toISOString()
      : "";
  if (
    !cardId ||
    !deckId ||
    !CLIENT_REVIEW_ID.test(clientReviewId) ||
    !GRADES.includes(rating) ||
    !reviewedAt
  ) {
    return badRequest(
      "cardId, deckId, clientReviewId, reviewedAt, and rating (1-4) are required"
    );
  }

  const requested: ReviewReceipt = {
    clientReviewId,
    cardId,
    deckId,
    rating,
    reviewedAt,
    mode,
  };
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
    const found = await getCardForReview(deckId, cardId, session);
    if (!found) {
      // Preserve idempotency for a retry whose original card was later deleted,
      // without making every ordinary review pay this read before the transaction.
      const existing = await getReviewReceipt(clientReviewId, session);
      if (existing) {
        return reviewReceiptsMatch(existing, requested)
          ? NextResponse.json({ ok: true, duplicate: true })
          : conflict("clientReviewId was already used for a different review");
      }
      return notFound("card not found");
    }

    // A durable offline queue can arrive after another device has reviewed the
    // same card. Never pass FSRS a timestamp older than the canonical state.
    const modeCard = cardForMode(found.card, mode);
    const parsedPreviousReview = modeCard.fsrs.last_review
      ? Date.parse(modeCard.fsrs.last_review)
      : Number.NaN;
    const previousReview = Number.isFinite(parsedPreviousReview)
      ? parsedPreviousReview
      : Number.NEGATIVE_INFINITY;
    const clientReviewTime = Math.min(
      Date.parse(reviewedAt),
      Date.now() + MAX_CLOCK_SKEW_MS
    );
    const effectiveReviewTime = new Date(
      Math.max(clientReviewTime, previousReview + 1)
    );
    const { card: updatedCard, log } = rateMode(
      found.card,
      mode,
      rating as Grade,
      effectiveReviewTime
    );
    const result = await commitReview({
      ...requested,
      card: updatedCard,
      expectedVersion: found.version,
      log,
      source: found.card.source,
      session,
    });

    if (result.status === "committed") {
      return NextResponse.json({ ok: true });
    }
    if (result.status === "duplicate") {
      return NextResponse.json({ ok: true, duplicate: true });
    }
    if (result.status === "mismatch") {
      return conflict("clientReviewId was already used for a different review");
    }
    // An optimistic version race: strongly re-read and recompute from the
    // winning state. The idempotency log still guarantees at-most-once apply.
    if (!(await getDeck(deckId, session))) return notFound("deck not found");
    if (attempt + 1 < MAX_WRITE_ATTEMPTS) {
      const backoffMs = Math.min(20 * 2 ** attempt + Math.random() * 20, 200);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }

  return NextResponse.json(
    { error: "card changed too many times; retry the same review" },
    { status: 503, headers: { "Retry-After": "1" } }
  );
}
