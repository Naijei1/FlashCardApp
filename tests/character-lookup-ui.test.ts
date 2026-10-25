// @vitest-environment jsdom
import { act, createElement, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import CharacterText from "@/components/CharacterText";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => createElement("a", { href }, children),
}));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ words: [], total: 0, truncated: false }),
    }))
  );
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function Harness() {
  const [flips, setFlips] = useState(0);
  return createElement(
    "div",
    { onClick: () => setFlips((count) => count + 1) },
    createElement(CharacterText, { text: "学习 hello", deckId: "deck", cardId: "card", lang: "zh-CN" }),
    createElement("span", { "data-flips": flips })
  );
}

it("opens a phone sheet from one character and leaves the card click alone", async () => {
  await act(async () => root.render(createElement(Harness)));
  const button = [...container.querySelectorAll("button")].find((item) => item.textContent === "学");
  expect(button?.getAttribute("aria-label")).toBe("Look up 学");
  expect(container.textContent).toContain("hello");
  expect(container.querySelector("[data-flips]")?.getAttribute("data-flips")).toBe("0");
  let graded = false;
  const onGrade = () => {
    graded = true;
  };
  window.addEventListener("keydown", onGrade);
  await act(async () => button!.click());
  expect(container.querySelector("[data-flips]")?.getAttribute("data-flips")).toBe("0");
  const dialog = document.body.querySelector("[role='dialog']");
  expect(dialog?.textContent).toContain("学 · appears in");
  expect(dialog?.textContent).toContain("No other words with this character yet.");
  expect(dialog?.textContent).not.toContain("Radical");
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
  expect(graded).toBe(false);
  window.removeEventListener("keydown", onGrade);
  expect(fetch).toHaveBeenCalledWith(
    "/api/characters?c=%E5%AD%A6&deckId=deck&cardId=card",
    expect.objectContaining({ signal: expect.any(AbortSignal) })
  );
});

it("anchors a popover on a wide viewport", async () => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("768"),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      words: [{ deckId: "deck", cardId: "other", hanzi: "学生", meaning: "student", pinyin: "xué shēng" }],
      total: 1,
      truncated: false,
      pinyin: "xí",
      gloss: "practice",
      radical: { number: 124, character: "羽", meaning: "feather" },
    }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  await act(async () => root.render(createElement(Harness)));
  const button = [...container.querySelectorAll("button")].find((item) => item.textContent === "习");
  await act(async () => button!.click());
  await act(async () => {
    await Promise.resolve();
  });
  const dialog = document.body.querySelector("[role='dialog']");
  expect(dialog?.textContent).toContain("习 · also in");
  expect(dialog?.textContent).toContain("学生");
  expect(dialog?.textContent).toContain("student");
  const text = dialog?.textContent ?? "";
  expect(text.indexOf("practice")).toBeGreaterThan(-1);
  expect(text.indexOf("practice")).toBeLessThan(text.indexOf("学生"));
  expect(text).toContain("Radical 124");
  expect(text).toContain("羽");
  expect(dialog?.className).toContain("rounded-2xl");
});

it("shows a gloss and radical on the phone sheet without hiding related words", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        words: [{ deckId: "deck", cardId: "other", hanzi: "烽火", meaning: "beacon fire", pinyin: "fēng huǒ" }],
        total: 1,
        truncated: false,
        pinyin: "fēng",
        gloss: "signal fire",
        radical: { number: 86, character: "火", meaning: "fire" },
      }),
    }))
  );
  await act(async () => root.render(createElement(Harness)));
  const button = [...container.querySelectorAll("button")].find((item) => item.textContent === "学");
  await act(async () => button!.click());
  await act(async () => {
    await Promise.resolve();
  });
  const dialog = document.body.querySelector("[role='dialog']");
  const text = dialog?.textContent ?? "";
  expect(text.indexOf("signal fire")).toBeGreaterThan(-1);
  expect(text.indexOf("signal fire")).toBeLessThan(text.indexOf("烽火"));
  expect(text).toContain("fēng");
  expect(text).toContain("Radical 86");
  expect(text).toContain("beacon fire");
});
