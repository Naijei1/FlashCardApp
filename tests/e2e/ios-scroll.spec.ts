import { test, expect } from "@playwright/test";
import {
  expectNoHorizontalOverflow,
  expectStudyFitsViewport,
  layoutMetrics,
  screenshot,
  signIn,
  simulateSoftKeyboard,
  studyInput,
} from "./helpers";

const ROUTES = [
  { name: "home", path: "/" },
  { name: "deck", path: "/decks/e2e-lesson-1" },
  { name: "browse", path: "/browse" },
  { name: "stats", path: "/stats" },
  { name: "import", path: "/import" },
  { name: "settings", path: "/settings" },
] as const;

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

for (const route of ROUTES) {
  test(`${route.name} does not overflow or drift sideways`, async ({ page }, info) => {
    await page.goto(route.path);
    await expect(page.locator("#main-content")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await screenshot(page, `${info.project.name}-${route.name}`);
  });
}

test("Mistake Clinic session locks the viewport and keeps write prompts in view", async ({ page }, info) => {
  await page.goto("/clinic");
  await expect(page.locator(".rounded-full").filter({ hasText: "Recognition" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Show answer" })).toBeVisible();
  await expectStudyFitsViewport(page);
  await screenshot(page, `${info.project.name}-clinic-review`);

  await page.getByRole("button", { name: "Show answer" }).click();
  await expect(page.getByRole("button", { name: /^Retry/ })).toBeVisible();
  await expectStudyFitsViewport(page);
  await page.getByRole("button", { name: /^Retry/ }).click();

  const input = page.locator("#clinic-input");
  await expect(input).toBeVisible();
  await expect(page.locator(".eyebrow")).toHaveText("Write Chinese");
  await expectStudyFitsViewport(page);
  const fontSize = await input.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(fontSize).toBeGreaterThanOrEqual(16);
  await input.focus();
  await simulateSoftKeyboard(page);
  await expect.poll(async () => (await layoutMetrics(page)).keyboardOpen).toBe(true);
  await expect.poll(async () => (await layoutMetrics(page)).scrollY).toBe(0);
  await expectStudyFitsViewport(page);
  const shell = await page.locator(".study-shell").boundingBox();
  const box = await input.boundingBox();
  expect(shell).toBeTruthy();
  expect(box).toBeTruthy();
  expect(box!.y).toBeGreaterThanOrEqual(shell!.y - 8);
  expect(box!.y + box!.height).toBeLessThanOrEqual(shell!.y + shell!.height + 8);
  await screenshot(page, `${info.project.name}-clinic-write-keyboard`);

  await page.getByRole("button", { name: "Don't know" }).click();
  await expect(page.getByRole("button", { name: /^Retry/ })).toBeVisible();
  await page.getByRole("button", { name: /^Retry/ }).click();

  await expect(page.locator(".eyebrow")).toHaveText("Write Pinyin");
  await expect(input).toBeVisible();
  await input.focus();
  await simulateSoftKeyboard(page);
  await expect.poll(async () => (await layoutMetrics(page)).keyboardOpen).toBe(true);
  await expect.poll(async () => (await layoutMetrics(page)).immersive).toBe(true);
  expect((await layoutMetrics(page)).scrollY).toBe(0);
  await screenshot(page, `${info.project.name}-clinic-pinyin-keyboard`);
});

test("browse search field stays 16px and does not zoom the layout", async ({ page }) => {
  await page.goto("/browse");
  const search = page.locator("#card-search");
  await expect(search).toBeVisible();
  const fontSize = await search.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(fontSize).toBeGreaterThanOrEqual(16);
  await search.focus();
  await expectNoHorizontalOverflow(page);
});

test("pagination returns to the top of the card list", async ({ page }) => {
  await page.goto("/browse");
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  expect((await layoutMetrics(page)).scrollY).toBeGreaterThan(0);
  await page.getByRole("link", { name: "Next →" }).click();
  await expect(page.getByText(/Page 2 of/)).toBeVisible();
  await expect.poll(async () => (await layoutMetrics(page)).scrollY).toBe(0);
});

test("spaced repetition fills the visual viewport without page scroll", async ({ page }, info) => {
  await page.goto("/review/e2e-lesson-1");
  await expect(page.getByRole("button", { name: "Show answer" })).toBeVisible();
  await expectStudyFitsViewport(page);
  await screenshot(page, `${info.project.name}-review`);
  await page.getByRole("button", { name: "Show answer" }).click();
  await expect(page.getByRole("button", { name: /^Retry/ })).toBeVisible();
  await expectStudyFitsViewport(page);
});

test("normal review swipe surface stays inside the viewport", async ({ page }, info) => {
  await page.goto("/study/e2e-lesson-1");
  await expect(page.getByRole("button", { name: "Shuffle" })).toBeVisible();
  await expectStudyFitsViewport(page);
  await screenshot(page, `${info.project.name}-study`);
});

test("write Chinese keeps the field in view when the keyboard covers the screen", async ({ page }, info) => {
  await page.goto("/write/e2e-lesson-1");
  const input = studyInput(page);
  await expect(input).toBeVisible();
  await expectStudyFitsViewport(page);
  const fontSize = await input.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(fontSize).toBeGreaterThanOrEqual(16);
  await input.focus();
  await simulateSoftKeyboard(page);
  await expect.poll(async () => (await layoutMetrics(page)).keyboardOpen).toBe(true);
  await expect.poll(async () => (await layoutMetrics(page)).scrollY).toBe(0);
  await expectStudyFitsViewport(page);
  const shell = await page.locator(".study-shell").boundingBox();
  const box = await input.boundingBox();
  expect(shell).toBeTruthy();
  expect(box).toBeTruthy();
  expect(box!.y).toBeGreaterThanOrEqual(shell!.y - 8);
  expect(box!.y + box!.height).toBeLessThanOrEqual(shell!.y + shell!.height + 8);
  await screenshot(page, `${info.project.name}-write-keyboard`);
});

test("write Pinyin hides the jumping dock and does not scroll the page", async ({ page }, info) => {
  await page.goto("/pinyin/e2e-lesson-1");
  const input = studyInput(page);
  await expect(input).toBeVisible();
  await input.focus();
  await simulateSoftKeyboard(page);
  await expect.poll(async () => (await layoutMetrics(page)).keyboardOpen).toBe(true);
  await expect.poll(async () => (await layoutMetrics(page)).immersive).toBe(true);
  expect((await layoutMetrics(page)).scrollY).toBe(0);
  await screenshot(page, `${info.project.name}-pinyin-keyboard`);
});

test("stats page is vertically scrollable without sideways drift", async ({ page }, info) => {
  await page.goto("/stats");
  await expect(page.getByRole("heading", { name: "Stats" })).toBeVisible();
  await page.evaluate(() => window.scrollBy(0, 200));
  await expectNoHorizontalOverflow(page);
  await screenshot(page, `${info.project.name}-stats`);
});
