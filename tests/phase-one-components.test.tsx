// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import AppShell from "@/components/AppShell";
import Chip from "@/components/Chip";
import InfoButton from "@/components/InfoButton";
import ModeLink from "@/components/ModeLink";

vi.mock("next/navigation", () => ({ usePathname: () => "/import" }));

it("opens the named info dialog, focuses Close and resets expanded on dismissal", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  try {
    await act(async () => root.render(<InfoButton topic="Study modes">Each mode has its own schedule.</InfoButton>));
    const trigger = container.querySelector<HTMLButtonElement>('[aria-label="About Study modes"]')!;
    const dialog = document.getElementById(trigger.getAttribute("aria-controls")!) as HTMLDialogElement;
    const close = dialog.querySelector("button")!;
    // jsdom implements the dialog element, but its modal methods require a browser.
    dialog.showModal = vi.fn(() => { dialog.open = true; });
    dialog.close = vi.fn(() => {
      dialog.open = false;
      dialog.dispatchEvent(new Event("close"));
    });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.getElementById(dialog.getAttribute("aria-labelledby")!)?.textContent).toBe("Study modes");
    expect(dialog.textContent).toContain("Each mode has its own schedule.");
    await act(async () => trigger.click());
    expect(dialog.showModal).toHaveBeenCalledOnce();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(close);
    await act(async () => close.click());
    expect(dialog.close).toHaveBeenCalledOnce();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it("exposes mode chips as link text and replaces the plain detail", () => {
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(
    <ModeLink href="/decks/lesson" title="Lesson" detail="old status line" chips={<Chip tone="accent">1 due</Chip>} />,
  );
  const link = container.querySelector("a")!;
  expect(link.textContent).toContain("1 due");
  expect(link.textContent).not.toContain("old status line");
  expect(link.hasAttribute("aria-label")).toBe(false);
  expect(link.querySelector(".tabular-nums")?.classList.contains("text-accent")).toBe(true);
});

it.each([
  ["user", ["/", "/browse", "/stats", "/settings"]],
  ["admin", ["/", "/admin/upload", "/admin/users", "/browse", "/settings"]],
] as const)("renders the expected %s links in both navigation layouts", (role, hrefs) => {
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(<AppShell role={role}>Content</AppShell>);
  const navs = container.querySelectorAll('nav[aria-label="Primary navigation"]');
  expect(navs).toHaveLength(2);
  for (const nav of navs) {
    expect([...nav.querySelectorAll("a")].map((link) => link.getAttribute("href"))).toEqual(hrefs);
    expect(nav.querySelector("[aria-current]")).toBeNull();
  }
});
