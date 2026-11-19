// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import LessonProgress from "@/components/LessonProgress";

it("labels readiness counts, the pooled struggle rate, and its separate latest-session comparison", () => {
  const node = document.createElement("div");
  node.innerHTML = renderToStaticMarkup(createElement(LessonProgress, {
    lessons: [{ id: "a", name: "Greetings", readiness: {
      review: { solid: 12, shaky: 5, unseen: 3 }, write: { solid: 0, shaky: 0, unseen: 0 },
    } }], target: 90, history: [
      { id: "1", startedAt: "2026-11-01", mode: "review", lessons: { a: [1, 2, 2, 0] } },
      { id: "2", startedAt: "2026-11-02", mode: "review", lessons: { a: [0, 0, 5, 0] } },
    ],
  }));
  const bar = node.querySelector('[role="img"][aria-label="Recognition: 12 solid, 5 shaky, 3 unseen"]');
  expect(bar?.getAttribute("title")).toBe(bar?.getAttribute("aria-label"));
  expect([...bar!.children].map((part) => part.getAttribute("title"))).toEqual(["12 solid", "5 shaky", "3 unseen"]);
  const label = "Struggle 30% over the last 2 sessions. Latest session 0%, down from 60%";
  expect(node.querySelector(`[aria-label="${label}"]`)?.getAttribute("title")).toBe(label);
  expect(node.textContent).toContain("12/20");
  expect(node.textContent).toContain("No words");
  expect(node.querySelector('[aria-label="No recent ratings"]')?.textContent).toBe("—");
});
