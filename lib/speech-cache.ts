import { createHash } from "node:crypto";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { doc, tableName } from "./dynamo";
import { NEURAL_RATE, NEURAL_VOICE } from "./speech-request";

/** In-process repeats of a line skip Dynamo and Edge. */
export const SPEECH_MEMORY_LIMIT = 100;
export const SPEECH_MEMORY_TTL_MS = 60 * 60 * 1000;
/** Dynamo TTL attribute is epoch seconds. Rows expire about 30 days after synthesis. */
export const SPEECH_DISK_TTL_SECONDS = 30 * 24 * 60 * 60;
/** Browser may reuse a successful clip for a day. Errors are `no-store`. */
export const SPEECH_BROWSER_MAX_AGE_SECONDS = 24 * 60 * 60;
/** Uncached syntheses per signed-in user. Cache hits do not count. */
export const SPEECH_RATE_LIMIT = 20;
export const SPEECH_RATE_WINDOW_MS = 10 * 60 * 1000;
const SPEECH_PK = "SPEECH";

type MemoryEntry = { audio: Uint8Array; expiresAt: number };
type RateBucket = { start: number; count: number };

const memory = new Map<string, MemoryEntry>();
const inflight = new Map<string, Promise<Uint8Array>>();
const rates = new Map<string, RateBucket>();

export function speechCacheKey(text: string, voice = NEURAL_VOICE, rate = NEURAL_RATE): string {
  return createHash("sha256").update(`${voice}\n${rate}\n${text}`).digest("hex");
}

export function resetSpeechState(): void {
  memory.clear();
  inflight.clear();
  rates.clear();
}

export function rememberSpeech(hash: string, audio: Uint8Array, now = Date.now()): void {
  memory.delete(hash);
  memory.set(hash, { audio, expiresAt: now + SPEECH_MEMORY_TTL_MS });
  while (memory.size > SPEECH_MEMORY_LIMIT) {
    const oldest = memory.keys().next().value;
    if (oldest === undefined) break;
    memory.delete(oldest);
  }
}

export function recallSpeech(hash: string, now = Date.now()): Uint8Array | null {
  const entry = memory.get(hash);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    memory.delete(hash);
    return null;
  }
  memory.delete(hash);
  memory.set(hash, entry);
  return entry.audio;
}

export type SpeechCredit =
  | { ok: true }
  | { ok: false; retryAfterSeconds: number };

/** One uncached synthesis. Expired windows start over. */
export function takeSpeechCredit(userId: string, now = Date.now()): SpeechCredit {
  if (rates.size > 1000) {
    for (const [key, bucket] of rates) {
      if (now - bucket.start >= SPEECH_RATE_WINDOW_MS) rates.delete(key);
    }
  }
  const current = rates.get(userId);
  if (!current || now - current.start >= SPEECH_RATE_WINDOW_MS) {
    rates.set(userId, { start: now, count: 1 });
    return { ok: true };
  }
  if (current.count >= SPEECH_RATE_LIMIT) {
    return {
      ok: false,
      retryAfterSeconds: Math.max(1, Math.ceil((current.start + SPEECH_RATE_WINDOW_MS - now) / 1000)),
    };
  }
  current.count += 1;
  return { ok: true };
}

function toBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  return null;
}

async function readDisk(hash: string): Promise<Uint8Array | null> {
  if (!process.env.TABLE_NAME) return null;
  try {
    const out = await doc.send(
      new GetCommand({
        TableName: tableName(),
        Key: { PK: SPEECH_PK, SK: hash },
      }),
    );
    const audio = toBytes(out.Item?.audio);
    const ttl = out.Item?.ttl;
    if (!audio || audio.length === 0) return null;
    if (typeof ttl === "number" && ttl * 1000 <= Date.now()) return null;
    return audio;
  } catch (error) {
    console.warn("Speech cache read failed", { name: error instanceof Error ? error.name : "error" });
    return null;
  }
}

async function writeDisk(hash: string, audio: Uint8Array): Promise<void> {
  if (!process.env.TABLE_NAME) return;
  if (audio.byteLength > 200_000) return;
  try {
    await doc.send(
      new PutCommand({
        TableName: tableName(),
        Item: {
          PK: SPEECH_PK,
          SK: hash,
          audio,
          ttl: Math.floor(Date.now() / 1000) + SPEECH_DISK_TTL_SECONDS,
        },
      }),
    );
  } catch (error) {
    console.warn("Speech cache write failed", { name: error instanceof Error ? error.name : "error" });
  }
}

export class SpeechRateLimited extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super("rate limited");
    this.name = "SpeechRateLimited";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * Memory, then Dynamo, then `synthesize`. Identical in-flight hashes share one synthesis.
 * `charge` runs only when this call is the one that starts synthesis.
 */
export async function loadSpeechAudio(
  hash: string,
  synthesize: () => Promise<Uint8Array>,
  charge: () => SpeechCredit,
): Promise<Uint8Array> {
  const pending = inflight.get(hash);
  if (pending) return pending;
  const memoryHit = recallSpeech(hash);
  if (memoryHit) return memoryHit;
  const diskHit = await readDisk(hash);
  if (diskHit) {
    rememberSpeech(hash, diskHit);
    return diskHit;
  }
  const again = inflight.get(hash);
  if (again) return again;
  const credit = charge();
  if (!credit.ok) throw new SpeechRateLimited(credit.retryAfterSeconds);
  const work = synthesize()
    .then(async (audio) => {
      rememberSpeech(hash, audio);
      await writeDisk(hash, audio);
      return audio;
    })
    .finally(() => {
      inflight.delete(hash);
    });
  inflight.set(hash, work);
  return work;
}
