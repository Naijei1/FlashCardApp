/**
 * Client clocks may run slightly ahead. A review further ahead than this is
 * rejected so it cannot move a release gate or schedule FSRS from the future.
 */
export const MAX_FUTURE_REVIEW_SKEW_MS = 5 * 60_000;

/**
 * Offline review queues live in localStorage and can sync after a long trip.
 * A month still covers that queue. Older stamps are rejected so a caller cannot
 * rewrite FSRS history by sending an arbitrary past `reviewedAt`.
 */
export const MAX_REVIEW_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function reviewTimestampError(reviewedAt: string, now = Date.now()): string | null {
  const time = Date.parse(reviewedAt);
  if (!Number.isFinite(time)) return "reviewedAt is invalid";
  if (time < now - MAX_REVIEW_AGE_MS) return "reviewedAt is too far in the past";
  if (time > now + MAX_FUTURE_REVIEW_SKEW_MS) return "reviewedAt is in the future";
  return null;
}
