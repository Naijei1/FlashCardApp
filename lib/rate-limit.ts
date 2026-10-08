const buckets = new Map<string, number[]>();

/** Fixed-window counter kept in memory for a single server instance. */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): { ok: true } | { ok: false; retryAfterSeconds: number } {
  const now = Date.now();
  const recent = (buckets.get(key) ?? []).filter((hit) => now - hit < windowMs);
  if (recent.length >= limit) {
    buckets.set(key, recent);
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (now - recent[0])) / 1000)) };
  }
  recent.push(now);
  buckets.set(key, recent);
  return { ok: true };
}
