import { releaseWeekLabel } from "./multi-user-model";
import type { Deck } from "./types";

/** Short label above a lesson name: Private, week N, or Shared. */
export function deckKicker(deck: Deck): string {
  if (deck.source === "private") return "Private";
  if (typeof deck.releaseWeek === "number") return releaseWeekLabel(deck.releaseWeek);
  return "Shared";
}
