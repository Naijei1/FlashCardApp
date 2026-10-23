import { statSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Chinese font subsets", () => {
  it("ships a small pinyin face and HSK-sized hanzi files", () => {
    expect(statSync("app/fonts/noto-sans-400.woff2").size).toBeLessThan(20_000);
    expect(statSync("app/fonts/noto-sans-700.woff2").size).toBeLessThan(20_000);
    expect(statSync("app/fonts/noto-sans-sc-400.woff2").size).toBeLessThan(600_000);
    expect(statSync("app/fonts/noto-serif-sc-600.woff2").size).toBeLessThan(800_000);
  });
});
