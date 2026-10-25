import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { generateSecMsGecV2, noteEdgeServerDate, resetEdgeClockSkew, edgeClockSkewSeconds } from "@/lib/edge-drm";
import { readAudioFrame, speechSsml } from "@/lib/edge-tts";
import {
  SPEECH_DISK_TTL_SECONDS,
  SPEECH_RATE_LIMIT,
  loadSpeechAudio,
  resetSpeechState,
  speechCacheKey,
  takeSpeechCredit,
} from "@/lib/speech-cache";
import { neuralSpeechPath } from "@/lib/speech-request";

const TOKENS: Record<string, string> = {
  "1600000000": "1F5E89103EC98A08-E69D008C1241797258F0EE06F56044C11FAEC4B60F95C6AB0DB3C5E79BE2F010",
  "1700000000": "2CD23A2CA0B2595A-F3C846C370E05F9CC83ACC5F995C5F5D87A4D0F14CE8936A0F902E64099E38A2",
  "1700000099": "2CD23A2CA0B2595A-F3C846C370E05F9CC83ACC5F995C5F5D87A4D0F14CE8936A0F902E64099E38A2",
  "1700000100": "0919602B5750900A-EC9DD394F23CB5635CF62A0E8E24136DCD32B26D10C543B10082E482D7516397",
};

describe("Edge Sec-MS-GEC v2", () => {
  beforeEach(() => resetEdgeClockSkew());

  it("matches edge-tts 7.3.1 for fixed timestamps", () => {
    for (const [stamp, token] of Object.entries(TOKENS)) {
      expect(generateSecMsGecV2(Number(stamp))).toBe(token);
    }
  });

  it("shifts the token clock from a server Date header", () => {
    const now = Date.parse("2026-10-25T12:00:00.000Z");
    expect(noteEdgeServerDate("Sun, 25 Oct 2026 12:05:00 GMT", now)).toBe(true);
    expect(edgeClockSkewSeconds()).toBeCloseTo(300, 0);
    expect(noteEdgeServerDate("not a date", now)).toBe(false);
  });
});

describe("neural speech URLs", () => {
  it("keeps short Chinese on the same-origin route and leaves everything else to device speech", () => {
    expect(neuralSpeechPath("  学习 ", "zh-CN")).toBe(`/api/speech?text=${encodeURIComponent("学习")}`);
    expect(neuralSpeechPath("学习", "zh_CN")).toBe(`/api/speech?text=${encodeURIComponent("学习")}`);
    expect(neuralSpeechPath("hello", "zh-CN")).toBeNull();
    expect(neuralSpeechPath("学习", "en-US")).toBeNull();
    expect(neuralSpeechPath("学".repeat(81), "zh-CN")).toBeNull();
    expect(neuralSpeechPath("学".repeat(80), "zh-CN")).toContain("text=");
  });
});

describe("speech frames and SSML", () => {
  it("reads MPEG bytes after the binary header", () => {
    const headers = "Path:audio\r\nContent-Type:audio/mpeg\r\n";
    const payload = Uint8Array.from([0xff, 0xfb, 0x90]);
    const frame = new Uint8Array(2 + headers.length + payload.length);
    frame[0] = 0;
    frame[1] = headers.length;
    frame.set(Buffer.from(headers), 2);
    frame.set(payload, 2 + headers.length);
    expect(readAudioFrame(frame)).toEqual(payload);
  });

  it("ignores the empty terminator frame", () => {
    const headers = "Path:audio\r\n";
    const frame = new Uint8Array(2 + headers.length);
    frame[1] = headers.length;
    frame.set(Buffer.from(headers), 2);
    expect(readAudioFrame(frame)).toBeNull();
  });

  it("escapes flashcard text inside the pinned Xiaoxiao voice", () => {
    const ssml = speechSsml("学<习> & 习");
    expect(ssml).toContain("name='zh-CN-XiaoxiaoNeural'");
    expect(ssml).toContain("rate='-10%'");
    expect(ssml).toContain("学&lt;习&gt; &amp; 习");
    expect(ssml).not.toContain("学<习>");
  });
});

describe("speech cache", () => {
  const send = vi.fn();

  beforeEach(() => {
    resetSpeechState();
    send.mockReset();
    process.env.TABLE_NAME = "flashcards-test";
    (globalThis as typeof globalThis & { __ddb?: { send: typeof send } }).__ddb = { send };
  });

  it("hashes voice, rate, and text", () => {
    const hash = speechCacheKey("学习");
    expect(hash).toBe(createHash("sha256").update("zh-CN-XiaoxiaoNeural\n-10%\n学习").digest("hex"));
  });

  it("serves a memory hit without calling Dynamo or synthesizing again", async () => {
    send.mockResolvedValue({});
    const synthesize = vi.fn().mockResolvedValue(Uint8Array.from([1, 2, 3]));
    const first = await loadSpeechAudio(speechCacheKey("学习"), synthesize, () => ({ ok: true }));
    const second = await loadSpeechAudio(speechCacheKey("学习"), synthesize, () => ({ ok: true }));
    expect(Array.from(second)).toEqual(Array.from(first));
    expect(synthesize).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0]).toBeInstanceOf(GetCommand);
    expect(send.mock.calls[1][0]).toBeInstanceOf(PutCommand);
    const put = send.mock.calls[1][0] as PutCommand;
    expect(put.input.Item?.PK).toBe("SPEECH");
    expect(put.input.Item?.SK).toBe(speechCacheKey("学习"));
    expect(put.input.Item?.ttl).toBeGreaterThan(Math.floor(Date.now() / 1000) + SPEECH_DISK_TTL_SECONDS - 5);
  });

  it("reuses a Dynamo row and does not synthesize", async () => {
    const stored = Uint8Array.from([9, 8, 7]);
    send.mockResolvedValueOnce({ Item: { audio: stored, ttl: Math.floor(Date.now() / 1000) + 100 } });
    const synthesize = vi.fn();
    const audio = await loadSpeechAudio("abc", synthesize, () => ({ ok: true }));
    expect(Array.from(audio)).toEqual([9, 8, 7]);
    expect(synthesize).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("shares one in-flight synthesis", async () => {
    delete process.env.TABLE_NAME;
    let release: (audio: Uint8Array) => void = () => {};
    const synthesize = vi.fn(
      () =>
        new Promise<Uint8Array>((resolve) => {
          release = resolve;
        }),
    );
    const hash = speechCacheKey("学校");
    const first = loadSpeechAudio(hash, synthesize, () => ({ ok: true }));
    const second = loadSpeechAudio(hash, synthesize, () => ({ ok: true }));
    await vi.waitFor(() => expect(synthesize).toHaveBeenCalledTimes(1));
    release(Uint8Array.from([4]));
    expect(Array.from(await first)).toEqual([4]);
    expect(Array.from(await second)).toEqual([4]);
    expect(synthesize).toHaveBeenCalledTimes(1);
  });

  it("stops charging after the uncached limit", () => {
    for (let i = 0; i < SPEECH_RATE_LIMIT; i += 1) expect(takeSpeechCredit("user", 1_000).ok).toBe(true);
    const blocked = takeSpeechCredit("user", 1_000);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(takeSpeechCredit("user", 1_000 + 10 * 60 * 1000).ok).toBe(true);
  });
});
