// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import AddCardForm from "@/components/AddCardForm";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));
let root: Root;
let container: HTMLDivElement;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fetchMock = vi.fn(() => new Promise(() => {}));
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(AddCardForm, { deckId: "deck" })));
  const inputs = container.querySelectorAll("input");
  await act(async () => {
    for (const [index, value] of ["你好", "hello"].entries()) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(inputs[index], value);
      inputs[index].dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
it("sends only one card creation for repeated submit events while saving", async () => {
  await act(async () => {
    container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it.each([{ isComposing: true }, { keyCode: 229 }])("prevents implicit form submission when Enter confirms an IME candidate: %o", async (flags) => {
  const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...flags });
  await act(async () => container.querySelector("input")!.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);
  expect(fetchMock).not.toHaveBeenCalled();
});
it("blocks submission during composition and allows it after the candidate is committed", async () => {
  const input = container.querySelector("input")!;
  const form = container.querySelector("form")!;
  await act(async () => {
    input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(fetchMock).not.toHaveBeenCalled();
  await act(async () => {
    input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ front: "你好", back: "hello" });
});
it("allows retrying after a failed save without losing the entered Chinese", async () => {
  fetchMock.mockRejectedValueOnce(new Error("offline"));
  const form = container.querySelector("form")!;
  await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  expect(container.querySelector("input")!.value).toBe("你好");
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
