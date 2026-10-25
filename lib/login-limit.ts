/** Shared by every Amplify server instance. The window matches the previous in-memory limiter. */
export const LOGIN_WINDOW_MS = 15 * 60_000;
/** Wrong passwords allowed before the next attempt is rejected with 429. */
export const LOGIN_FREE_ATTEMPTS = 5;
export const LOGIN_MAX_BLOCK_SECONDS = 60;

export type AttemptState = {
  failures: number;
  windowStartedAt: number;
  blockedUntil: number;
};

/**
 * `absent` inserts a new row. An existing state is an optimistic lock: the
 * write must still see those failure/window values.
 */
export type AttemptExpectation = AttemptState | "absent";

export type AttemptStore = {
  get(key: string): Promise<AttemptState | null>;
  save(key: string, next: AttemptState, expected: AttemptExpectation): Promise<boolean>;
  delete(key: string): Promise<void>;
};

export type LoginLimitResult =
  | { status: "allowed" }
  | { status: "rejected" }
  | { status: "blocked"; retryAfterSeconds: number };

/**
 * CloudFront appends the viewer address to any incoming X-Forwarded-For value,
 * so the last entry cannot be replaced by a caller-supplied prefix.
 */
/** Seconds left on an active block, or null when this key may try again. */
export function retryAfterBlock(state: AttemptState | null, now: number): number | null {
  if (!state || now - state.windowStartedAt >= LOGIN_WINDOW_MS) return null;
  if (state.blockedUntil <= now) return null;
  return Math.max(1, Math.ceil((state.blockedUntil - now) / 1000));
}

export function clientAddressKey(headerList: { get(name: string): string | null }): string {
  const forwarded = headerList
    .get("x-forwarded-for")
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .at(-1);
  return (forwarded || headerList.get("x-real-ip") || "unknown").slice(0, 128);
}

const WRITE_ATTEMPTS = 6;

function blockSeconds(failures: number): number {
  return Math.min(2 ** (failures - LOGIN_FREE_ATTEMPTS), LOGIN_MAX_BLOCK_SECONDS);
}

/**
 * Counts wrong passwords for one client key. A correct password is refused
 * while a block is already in effect, matching the previous route: the check
 * happens before the password is read. The attempt that crosses the free
 * allowance still returns `rejected` (HTTP 401) and arms `blockedUntil`; the
 * next attempt inside that window returns `blocked` (HTTP 429).
 */
export async function limitLogin(
  store: AttemptStore,
  key: string,
  now: number,
  checkPassword: () => boolean | Promise<boolean>
): Promise<LoginLimitResult> {
  let passwordCorrect: boolean | null = null;
  for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
    const current = await store.get(key);
    const fresh = !current || now - current.windowStartedAt >= LOGIN_WINDOW_MS;
    const active = fresh ? null : current;
    if (passwordCorrect === null && active && active.blockedUntil > now) {
      return {
        status: "blocked",
        retryAfterSeconds: Math.max(1, Math.ceil((active.blockedUntil - now) / 1000)),
      };
    }
    if (passwordCorrect === null) passwordCorrect = await checkPassword();
    if (passwordCorrect) {
      if (current) await store.delete(key);
      return { status: "allowed" };
    }
    if (active && active.blockedUntil > now) {
      return {
        status: "blocked",
        retryAfterSeconds: Math.max(1, Math.ceil((active.blockedUntil - now) / 1000)),
      };
    }
    const base: AttemptState = active ?? { failures: 0, windowStartedAt: now, blockedUntil: 0 };
    const next: AttemptState = {
      failures: base.failures + 1,
      windowStartedAt: base.windowStartedAt,
      blockedUntil: 0,
    };
    if (next.failures > LOGIN_FREE_ATTEMPTS) {
      next.blockedUntil = now + blockSeconds(next.failures) * 1000;
    }
    const expected: AttemptExpectation = active ? active : current ? current : "absent";
    const saved = await store.save(key, next, expected);
    if (!saved) continue;
    return { status: "rejected" };
  }
  return { status: "blocked", retryAfterSeconds: 1 };
}
