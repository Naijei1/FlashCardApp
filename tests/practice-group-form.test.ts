// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import PracticeGroupForm from "@/components/PracticeGroupForm";
import type { LessonSection } from "@/lib/practice-groups";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh }) }));

let root: Root;
let container: HTMLDivElement;
let fetchMock: ReturnType<typeof vi.fn>;

const sections = [
  { title: "Book 1", lessons: [{ id: "l1", name: "Lesson 1", cards: 10 }, { id: "l2", name: "Lesson 2", cards: 8 }] },
] as unknown as LessonSection[];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ id: "g1" }) }));
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find((item) => item.textContent?.includes(label));
  expect(found, label).toBeTruthy();
  return found!;
}

async function rename(value: string) {
  const input = container.querySelector("input:not([type=checkbox])") as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function sentBody(): Record<string, unknown> {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toBe("/api/practice-groups/g1");
  expect(init.method).toBe("PATCH");
  return JSON.parse(init.body as string);
}

it("renames a group whose saved lessons are all unavailable without wiping them", async () => {
  const onDone = vi.fn();
  const group = { id: "g1", name: "Old", deckIds: ["hidden-a", "hidden-b"] };
  await act(async () => root.render(createElement(PracticeGroupForm, { sections, group, onDone })));
  await rename("Final review");
  const save = button("Save changes");
  expect(save.disabled).toBe(false);
  await act(async () => save.click());
  expect(sentBody()).toEqual({ name: "Final review" });
  expect(onDone).toHaveBeenCalled();
});

it("sends the new lesson selection when it changes, and blocks clearing every lesson", async () => {
  const group = { id: "g1", name: "Old", deckIds: ["l1", "hidden-a"] };
  await act(async () => root.render(createElement(PracticeGroupForm, { sections, group, onDone: vi.fn() })));
  const [l1, l2] = [...container.querySelectorAll<HTMLInputElement>("input[type=checkbox]")];
  await act(async () => l1.click());
  expect(button("Save changes").disabled).toBe(true);
  await act(async () => l2.click());
  expect(button("Save changes").disabled).toBe(false);
  await act(async () => button("Save changes").click());
  expect(sentBody()).toEqual({ name: "Old", deckIds: ["l2"] });
});

async function setField(selector: string, value: string) {
  const field = container.querySelector(selector) as HTMLInputElement | HTMLSelectElement;
  const proto = field instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event(field instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}

it("sends an exam date and target recall only when they change", async () => {
  const group = { id: "g1", name: "Final", deckIds: ["l1"] };
  await act(async () => root.render(createElement(PracticeGroupForm, { sections, group, onDone: vi.fn() })));
  expect((container.querySelector("select") as HTMLSelectElement).disabled).toBe(true);
  await setField("input[type=date]", "2026-12-18");
  await setField("select", "0.9");
  await act(async () => button("Save changes").click());
  expect(sentBody()).toEqual({ name: "Final", examDate: "2026-12-18", targetRecall: 0.9 });
});

it("keeps a past exam date on rename and sends null when cleared", async () => {
  const group = { id: "g1", name: "Final", deckIds: ["l1"], examDate: "2026-01-10", targetRecall: 0.9 };
  await act(async () => root.render(createElement(PracticeGroupForm, { sections, group, onDone: vi.fn() })));
  await rename("Final (done)");
  await act(async () => button("Save changes").click());
  expect(sentBody()).toEqual({ name: "Final (done)" });

  fetchMock.mockClear();
  await act(async () => button("Clear").click());
  await act(async () => button("Save changes").click());
  expect(sentBody()).toEqual({ name: "Final (done)", examDate: null });
});
