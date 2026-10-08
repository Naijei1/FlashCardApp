import { expect, type Page, type Locator } from "@playwright/test";

export const E2E_PASSWORD = "test-password-12";

export async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Unlock" }).click();
  await page.waitForURL((url) => url.pathname === "/");
}

export async function layoutMetrics(page: Page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    const rootStyle = getComputedStyle(root);
    const bodyStyle = getComputedStyle(body);
    return {
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      clientWidth: root.clientWidth,
      scrollWidth: Math.max(root.scrollWidth, body.scrollWidth),
      scrollHeight: Math.max(root.scrollHeight, body.scrollHeight),
      bodyOverflowX: bodyStyle.overflowX,
      htmlOverflowX: rootStyle.overflowX,
      immersive: root.classList.contains("immersive"),
      keyboardOpen: root.classList.contains("keyboard-open"),
      appHeight: root.style.getPropertyValue("--app-height"),
      dockHidden: getComputedStyle(document.querySelector(".nav-dock-wrap") ?? body).visibility,
    };
  });
}

export async function expectNoHorizontalOverflow(page: Page) {
  const metrics = await layoutMetrics(page);
  expect(metrics.bodyOverflowX, "body overflow-x").toBe("clip");
  expect(metrics.htmlOverflowX, "html overflow-x").toBe("clip");
  expect(metrics.scrollWidth, "scrollWidth").toBeLessThanOrEqual(metrics.clientWidth + 1);
  expect(metrics.scrollX, "scrollX").toBe(0);
}

export async function expectStudyFitsViewport(page: Page) {
  const metrics = await layoutMetrics(page);
  expect(metrics.immersive).toBe(true);
  const shell = page.locator(".study-shell");
  await expect(shell).toBeVisible();
  const box = await shell.boundingBox();
  expect(box).toBeTruthy();
  expect(box!.y).toBeGreaterThanOrEqual(-1);
  expect(box!.height).toBeLessThanOrEqual(metrics.innerHeight + 2);
  expect(metrics.scrollY).toBe(0);
}

export async function simulateSoftKeyboard(page: Page, cover = 320) {
  await page.evaluate((covered) => {
    const height = Math.max(200, window.innerHeight - covered);
    const original = window.visualViewport;
    const fake = {
      height,
      width: original?.width ?? window.innerWidth,
      offsetTop: 0,
      offsetLeft: 0,
      scale: original?.scale ?? 1,
      pageTop: 0,
      pageLeft: 0,
      addEventListener: original?.addEventListener.bind(original) ?? (() => {}),
      removeEventListener: original?.removeEventListener.bind(original) ?? (() => {}),
      dispatchEvent: original?.dispatchEvent.bind(original) ?? (() => true),
    };
    Object.defineProperty(window, "visualViewport", { configurable: true, value: fake });
    fake.dispatchEvent(new Event("resize"));
    window.dispatchEvent(new Event("resize"));
  }, cover);
}

export async function screenshot(page: Page, name: string) {
  await page.screenshot({
    path: `tests/e2e/artifacts/${name}.png`,
    fullPage: false,
  });
}

export function studyInput(page: Page): Locator {
  return page.locator("#write-input");
}
