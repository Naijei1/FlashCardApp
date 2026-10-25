import { afterEach, describe, expect, it, vi } from "vitest";

class FakeAudio {
  static instances: FakeAudio[] = [];
  src = "";
  preload = "";
  onerror: (() => void) | null = null;
  pause = vi.fn();
  removeAttribute = vi.fn();

  constructor() {
    FakeAudio.instances.push(this);
  }

  play(): Promise<void> {
    return Promise.resolve();
  }
}

function installSpeech() {
  const speak = vi.fn();
  const cancel = vi.fn();
  vi.stubGlobal("Audio", FakeAudio);
  vi.stubGlobal("window", {
    speechSynthesis: {
      speak,
      cancel,
      getVoices: () => [],
      addEventListener: () => {},
    },
  });
  vi.stubGlobal("SpeechSynthesisUtterance", class {
    text = "";
    lang = "";
    rate = 1;
    voice?: unknown;
    constructor(text: string) {
      this.text = text;
    }
  });
  return { speak, cancel };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  FakeAudio.instances = [];
});

describe("useSpeech playback", () => {
  it("starts neural audio inside the gesture and does not wait for the file", async () => {
    const web = installSpeech();
    const play = vi.spyOn(FakeAudio.prototype, "play");
    const { useSpeech } = await import("@/components/useSpeech");
    useSpeech().speak("学习", "zh-CN");
    const audio = FakeAudio.instances[0];
    expect(audio.src).toBe(`/api/speech?text=${encodeURIComponent("学习")}`);
    expect(play).toHaveBeenCalledTimes(1);
    expect(web.speak).not.toHaveBeenCalled();
    expect(web.cancel).toHaveBeenCalled();
  });

  it("falls back to device speech when playback is rejected", async () => {
    const web = installSpeech();
    FakeAudio.prototype.play = vi.fn(() => Promise.reject(new Error("blocked")));
    const { useSpeech } = await import("@/components/useSpeech");
    useSpeech().speak("学习", "zh-CN");
    await Promise.resolve();
    await Promise.resolve();
    expect(web.speak).toHaveBeenCalledTimes(1);
    const utterance = web.speak.mock.calls[0][0] as { text: string; lang: string; rate: number };
    expect(utterance.text).toBe("学习");
    expect(utterance.lang).toBe("zh-CN");
    expect(utterance.rate).toBe(0.9);
  });

  it("keeps English on device speech", async () => {
    const web = installSpeech();
    const { useSpeech } = await import("@/components/useSpeech");
    useSpeech().speak("hello", "en-US");
    expect(FakeAudio.instances).toHaveLength(0);
    expect(web.speak).toHaveBeenCalledTimes(1);
  });
});
