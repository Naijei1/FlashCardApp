import { NextResponse } from "next/server";
import { badRequest, notFound, requireRegularUser } from "@/lib/api";
import { appTimeZone } from "@/lib/forecast";
import { cardForMode } from "@/lib/modes";
import { buildStudyQueue } from "@/lib/pinyin-queue";
import { DAILY_WORD_GOAL, introducedToday } from "@/lib/practice";
import { ALL_DECK, loadStudySet } from "@/lib/study-sets";
import type { ReviewMode } from "@/lib/types";

const MODES: ReviewMode[] = ["review", "write", "pinyin"];

export async function GET(request: Request) {
  const auth = await requireRegularUser();
  if (auth.response) return auth.response;
  const searchParams = new URL(request.url).searchParams;
  const deckId = searchParams.get("deckId") || ALL_DECK;
  const newOnly = searchParams.get("new") === "1";
  const mode = (searchParams.get("mode") || "review") as ReviewMode;
  if (!MODES.includes(mode)) return badRequest("unsupported mode");

  const set = await loadStudySet(deckId, auth.session);
  if (!set) return notFound("deck not found");
  const now = new Date();
  const cards = set.cards.map((card) => cardForMode(card, mode));
  // Regular sessions introduce at most a day's worth of new words per skill;
  // "Learn new words" is the explicit way to go beyond that.
  const newLimit = Math.max(0, DAILY_WORD_GOAL - introducedToday(cards, now, appTimeZone()));
  const data = buildStudyQueue(cards, { mode, sideFor: set.sideFor, now, newOnly, newLimit });
  return NextResponse.json(data, {
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}
