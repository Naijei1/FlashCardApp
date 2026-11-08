const TTL_MS = 12_000;

type Entry = { at: number; data: unknown };
const hits = new Map<string, Entry>();
/** Bumped when a review is queued or the signed-in user changes, so an in-flight warm cannot refill a stale queue. */
let epoch = 0;

export function reviewQueueUrl(deckId: string, mode: string, newOnly = false): string {
  const params = new URLSearchParams({ deckId, mode });
  if (newOnly) params.set("new", "1");
  return `/api/review/queue?${params}`;
}

/** Epoch captured when a warm fetch starts. A later save or account switch rejects that response. */
export function captureStudyQueueEpoch(): number {
  return epoch;
}

export function rememberStudyQueue(url: string, data: unknown, capturedEpoch = epoch): void {
  if (capturedEpoch !== epoch) return;
  hits.set(url, { at: Date.now(), data });
}

/** One-shot read so a later refresh, or a review on this device, fetches again. */
export function readStudyQueue<T>(url: string, now = Date.now()): T | null {
  const hit = hits.get(url);
  if (!hit) return null;
  hits.delete(url);
  if (now - hit.at > TTL_MS) return null;
  return hit.data as T;
}

export function clearStudyQueueCache(): void {
  epoch += 1;
  hits.clear();
}
