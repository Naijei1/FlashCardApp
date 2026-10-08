// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, createElement, useRef, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useKeepInView } from "@/components/useKeepInView";
import { scrollDocumentToTop, useViewportLock } from "@/components/useViewportLock";
import AppShell from "@/components/AppShell";
import WriteSession from "@/components/WriteSession";
import ReviewSession from "@/components/ReviewSession";
import { emptyCardState } from "@/lib/fsrs";
import { buildStudyQueue } from "@/lib/pinyin-queue";
import { cardForMode } from "@/lib/modes";
import type { Card, ReviewMode } from "@/lib/types";

const nav = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
  notFound: () => {
    throw new Error("not found");
  },
}));
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    onClick,
  }: {
    children: React.ReactNode;
    href: string;
    onClick?: () => void;
  }) => createElement("a", { href, onClick }, children),
}));
vi.mock("@/components/TtsButton", () => ({ default: () => null }));

const css = readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");

let root: Root;
let container: HTMLDivElement;
let card: Card;
let fetchMock: ReturnType<typeof vi.fn>;

function mockVisualViewport(height: number, offsetTop = 0) {
  const target = new EventTarget();
  const viewport = {
    height,
    width: 390,
    offsetTop,
    offsetLeft: 0,
    scale: 1,
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
  };
  vi.stubGlobal("visualViewport", viewport);
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 });
  return viewport;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  nav.pathname = "/";
  document.documentElement.className = "";
  document.documentElement.style.cssText = "";
  document.body.style.cssText = "";
  card = {
    id: "card",
    deckId: "deck",
    front: "你好",
    back: "hello",
    createdAt: "2026-09-16T12:00:00.000Z",
    updatedAt: "2026-09-16T12:00:00.000Z",
    fsrs: emptyCardState(new Date("2026-09-16T12:00:00.000Z")),
  };
  fetchMock = vi.fn(async (url: string) => {
    const mode = (new URL(url, "https://example.com").searchParams.get("mode") ?? "review") as ReviewMode;
    const data = buildStudyQueue([cardForMode(card, mode)], {
      mode,
      sideFor: () => "front" as const,
      now: new Date("2026-09-16T12:00:00.000Z"),
    });
    return { ok: true, json: async () => data };
  });
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.documentElement.className = "";
  document.documentElement.style.cssText = "";
});

async function render(element: ReactElement) {
  await act(async () => root.render(element));
}

describe("iOS scroll CSS invariants", () => {
  it("clips horizontal overflow without creating a nested Y scroller", () => {
    expect(css).toMatch(/html\s*\{[^}]*overflow-x:\s*clip/);
    expect(css).toMatch(/body\s*\{[^}]*overflow-x:\s*clip/);
    expect(css).not.toMatch(/overflow-x:\s*hidden/);
  });

  it("does not use 100vh or h-screen, which jump with the iOS URL bar", () => {
    expect(css).not.toMatch(/\b100vh\b/);
    expect(css).not.toMatch(/\bh-screen\b/);
  });

  it("locks immersive study screens and contains nested scrollers", () => {
    expect(css).toMatch(/html\.immersive/);
    expect(css).toMatch(/overscroll-behavior:\s*contain/);
    expect(css).toMatch(/html\.keyboard-open \.nav-dock-wrap/);
    const layout = readFileSync(path.join(process.cwd(), "app/layout.tsx"), "utf8");
    expect(layout).toMatch(/viewportFit:\s*"cover"/);
  });
});

it("scrollDocumentToTop clears window, document, and body scroll offsets", () => {
  window.scrollTo = ((x: number, y: number) => {
    Object.defineProperty(window, "scrollX", { configurable: true, value: x });
    Object.defineProperty(window, "scrollY", { configurable: true, value: y });
  }) as typeof window.scrollTo;
  window.scrollTo(40, 220);
  document.documentElement.scrollTop = 220;
  document.body.scrollTop = 180;
  scrollDocumentToTop();
  expect(window.scrollY).toBe(0);
  expect(document.documentElement.scrollTop).toBe(0);
  expect(document.body.scrollTop).toBe(0);
});

function ViewportProbe({ immersive }: { immersive: boolean }) {
  useViewportLock(immersive);
  return createElement("div", { "data-testid": "probe" });
}

it("pins immersive sessions to the visual viewport height", async () => {
  const viewport = mockVisualViewport(520, 12);
  await render(createElement(ViewportProbe, { immersive: true }));
  await act(async () => {
    viewport.dispatchEvent(new Event("resize"));
  });
  expect(document.documentElement.classList.contains("immersive")).toBe(true);
  expect(document.documentElement.style.getPropertyValue("--app-height")).toBe("520px");
  expect(document.documentElement.style.getPropertyValue("--app-offset")).toBe("12px");
});

it("marks the soft keyboard open without scrolling the document", async () => {
  const viewport = mockVisualViewport(400, 0);
  const scrollIntoView = vi.fn();
  HTMLElement.prototype.scrollIntoView = scrollIntoView;
  window.scrollTo(0, 80);
  await render(createElement(ViewportProbe, { immersive: false }));
  await act(async () => {
    viewport.dispatchEvent(new Event("resize"));
  });
  expect(document.documentElement.classList.contains("keyboard-open")).toBe(true);
  expect(scrollIntoView).not.toHaveBeenCalled();
});

function KeepInViewProbe() {
  const ref = useRef<HTMLInputElement>(null);
  useKeepInView(ref);
  return createElement(
    "div",
    { className: "study-scroll", "data-testid": "scroller" },
    createElement("input", { id: "field", ref })
  );
}

it("keeps a focused write field in view by scrolling the study scroller, not the page", async () => {
  mockVisualViewport(400, 0);
  const pageScroll = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
  await render(createElement(KeepInViewProbe));
  const scroller = container.querySelector<HTMLElement>(".study-scroll")!;
  const field = container.querySelector<HTMLInputElement>("#field")!;
  Object.defineProperty(scroller, "clientHeight", { value: 200, configurable: true });
  Object.defineProperty(scroller, "scrollTop", { value: 0, writable: true, configurable: true });
  const scrollTo = vi.fn();
  scroller.scrollTo = scrollTo as unknown as typeof scroller.scrollTo;
  vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue({
    top: 80, bottom: 280, left: 0, right: 390, width: 390, height: 200, x: 0, y: 80, toJSON: () => {},
  } as DOMRect);
  vi.spyOn(field, "getBoundingClientRect").mockReturnValue({
    top: 360, bottom: 424, left: 16, right: 374, width: 358, height: 64, x: 16, y: 360, toJSON: () => {},
  } as DOMRect);
  await act(async () => {
    field.focus();
    document.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  });
  expect(pageScroll).not.toHaveBeenCalled();
  expect(scrollTo).toHaveBeenCalled();
  expect(scrollTo.mock.calls[0][0]).toMatchObject({ behavior: "auto" });
});

it("uses a clipped study shell without the bottom dock on review routes", async () => {
  nav.pathname = "/review/deck";
  await render(createElement(AppShell, null, createElement("p", null, "Review")));
  expect(container.querySelector(".study-shell")).not.toBeNull();
  expect(container.querySelector(".nav-dock-wrap")).toBeNull();
  expect(document.documentElement.classList.contains("immersive")).toBe(true);
  expect(container.textContent).toContain("Review");
});

it("keeps the dock on browsing pages and resets scroll on route changes", async () => {
  nav.pathname = "/browse";
  window.scrollTo = ((x: number, y: number) => {
    Object.defineProperty(window, "scrollX", { configurable: true, value: x });
    Object.defineProperty(window, "scrollY", { configurable: true, value: y });
  }) as typeof window.scrollTo;
  window.scrollTo(0, 400);
  document.body.scrollTop = 400;
  await render(createElement(AppShell, null, createElement("p", null, "Browse")));
  expect(container.querySelector(".nav-dock-wrap")).not.toBeNull();
  expect(container.querySelector(".study-shell")).toBeNull();
  expect(window.scrollY).toBe(0);
  expect(document.body.scrollTop).toBe(0);
});

it("lays out write mode as a viewport-locked frame with an inner scroller", async () => {
  await render(
    createElement(WriteSession, { deckId: "deck", chineseLang: "zh-CN", backHref: "/" })
  );
  await vi.waitFor(() => expect(container.querySelector("#write-input")).not.toBeNull());
  const frame = container.querySelector(".study-frame");
  const scroller = container.querySelector(".study-scroll");
  const input = container.querySelector<HTMLInputElement>("#write-input");
  expect(frame).not.toBeNull();
  expect(scroller).not.toBeNull();
  expect(frame?.className).not.toMatch(/min-h-dvh|h-dvh|h-screen/);
  expect(input?.className).toMatch(/\binput\b/);
  expect(input?.className).toMatch(/text-2xl/);
});

it("lays out spaced repetition as a viewport-locked frame", async () => {
  await render(createElement(ReviewSession, { deckId: "deck", deckLangs: {}, backHref: "/" }));
  await vi.waitFor(() => expect(container.querySelector(".flashcard")).not.toBeNull());
  const frame = container.querySelector(".study-frame");
  expect(frame).not.toBeNull();
  expect(frame?.className).not.toMatch(/min-h-dvh|h-screen/);
  expect(container.querySelector(".flashcard")).not.toBeNull();
});
