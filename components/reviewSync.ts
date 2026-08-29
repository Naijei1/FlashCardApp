"use client";

// Serialized background persistence of review ratings so the UI can advance
// instantly. POSTs run in order (a re-enqueued card's second rating must land
// after its first) with one retry each.

type PendingReview = { cardId: string; deckId: string; rating: number };

export function createReviewSync(onFailure: (failedCount: number) => void) {
  let chain: Promise<void> = Promise.resolve();
  let failed = 0;

  async function post(review: PendingReview): Promise<boolean> {
    try {
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(review),
        keepalive: true,
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  return {
    push(review: PendingReview) {
      chain = chain.then(async () => {
        if ((await post(review)) || (await post(review))) return;
        failed += 1;
        onFailure(failed);
      });
    },
  };
}
