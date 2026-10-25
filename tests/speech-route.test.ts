import { beforeEach, describe, expect, it, vi } from "vitest";
import { SPEECH_RATE_LIMIT, resetSpeechState } from "@/lib/speech-cache";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  synth: vi.fn(),
  send: vi.fn(),
}));

vi.mock("@/lib/app-session", () => ({ getAppSession: mocks.session }));
vi.mock("@/lib/edge-tts", () => ({ synthesizeEdgeSpeech: mocks.synth }));

const learner = {
  userId: "learner-1",
  email: "learner@example.com",
  role: "user" as const,
  emailVerified: true,
  authMode: "google" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  resetSpeechState();
  process.env.TABLE_NAME = "flashcards-test";
  (globalThis as typeof globalThis & { __ddb?: { send: typeof mocks.send } }).__ddb = { send: mocks.send };
  mocks.session.mockResolvedValue(learner);
  mocks.send.mockResolvedValue({});
  mocks.synth.mockResolvedValue(Uint8Array.from([0xff, 0xfb, 0x90, 0x00]));
});

describe("GET /api/speech", () => {
  it("requires a session before synthesis", async () => {
    mocks.session.mockResolvedValue(null);
    const { GET } = await import("@/app/api/speech/route");
    const res = await GET(new Request("https://flashcards.example/api/speech?text=%E5%AD%A6"));
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(mocks.synth).not.toHaveBeenCalled();
  });

  it("rejects English, long text, and other voices", async () => {
    const { GET } = await import("@/app/api/speech/route");
    expect((await GET(new Request("https://flashcards.example/api/speech?text=hello"))).status).toBe(400);
    const long = "学".repeat(81);
    expect((await GET(new Request(`https://flashcards.example/api/speech?text=${encodeURIComponent(long)}`))).status).toBe(400);
    expect(
      (await GET(new Request("https://flashcards.example/api/speech?text=%E5%AD%A6&voice=en-US-AriaNeural"))).status,
    ).toBe(400);
    expect(mocks.synth).not.toHaveBeenCalled();
  });

  it("returns cached MPEG and does not synthesize the same line twice", async () => {
    const { GET } = await import("@/app/api/speech/route");
    const first = await GET(new Request("https://flashcards.example/api/speech?text=%E5%AD%A6%E4%B9%A0"));
    expect(first.status).toBe(200);
    expect(first.headers.get("content-type")).toBe("audio/mpeg");
    expect(first.headers.get("cache-control")).toBe("private, max-age=86400");
    expect(first.headers.get("cdn-cache-control")).toBe("no-store");
    expect(new Uint8Array(await first.arrayBuffer())).toEqual(Uint8Array.from([0xff, 0xfb, 0x90, 0x00]));
    const second = await GET(new Request("https://flashcards.example/api/speech?text=%E5%AD%A6%E4%B9%A0"));
    expect(second.status).toBe(200);
    expect(mocks.synth).toHaveBeenCalledTimes(1);
    expect(mocks.synth).toHaveBeenCalledWith("学习");
  });

  it("returns 429 once this user has spent the uncached budget", async () => {
    const { GET } = await import("@/app/api/speech/route");
    for (let i = 0; i < SPEECH_RATE_LIMIT; i += 1) {
      const res = await GET(new Request(`https://flashcards.example/api/speech?text=${encodeURIComponent(`学${i}`)}`));
      expect(res.status).toBe(200);
    }
    const blocked = await GET(new Request(`https://flashcards.example/api/speech?text=${encodeURIComponent("学新")}`));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
    expect(blocked.headers.get("cache-control")).toContain("no-store");
    expect(mocks.synth).toHaveBeenCalledTimes(SPEECH_RATE_LIMIT);
  });

  it("returns 502 when Edge fails so the browser can fall back", async () => {
    mocks.synth.mockRejectedValue(new Error("speech socket failed"));
    const { GET } = await import("@/app/api/speech/route");
    const res = await GET(new Request("https://flashcards.example/api/speech?text=%E4%B9%A0"));
    expect(res.status).toBe(502);
    expect(res.headers.get("cache-control")).toContain("no-store");
  });
});
