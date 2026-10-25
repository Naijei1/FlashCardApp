import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function covers(range: string, codepoint: number): boolean {
  return range.split(",").some((part) => {
    const body = part.trim().replace(/^U\+/i, "");
    if (!body) return false;
    if (body.includes("-")) {
      const [start, end] = body.split("-");
      return codepoint >= Number.parseInt(start, 16) && codepoint <= Number.parseInt(end, 16);
    }
    return codepoint === Number.parseInt(body, 16);
  });
}

describe("Chinese font subsets", () => {
  const fonts = readFileSync("app/fonts.ts", "utf8");
  const css = readFileSync("app/globals.css", "utf8");
  const ranges = [...fonts.matchAll(/prop: "unicode-range", value: "([^"]+)"/g)].map((match) => match[1]);

  it("ships a small pinyin face and an HSK-sized sans hanzi file", () => {
    expect(existsSync("app/fonts/noto-sans-400.woff2")).toBe(true);
    expect(existsSync("app/fonts/noto-sans-700.woff2")).toBe(true);
    expect(existsSync("app/fonts/noto-sans-sc-400.woff2")).toBe(true);
    expect(existsSync("app/fonts/noto-serif-sc-600.woff2")).toBe(false);
    expect(readFileSync("app/(app)/layout.tsx", "utf8")).not.toContain("notoSerif");
  });

  it("limits each web font to glyphs it actually contains", () => {
    expect(ranges).toHaveLength(2);
    const [latin, hanzi] = ranges;
    expect(covers(latin, "A".codePointAt(0)!)).toBe(true);
    expect(covers(latin, "火".codePointAt(0)!)).toBe(false);
    expect(covers(hanzi, "学".codePointAt(0)!)).toBe(true);
    expect(covers(hanzi, "火".codePointAt(0)!)).toBe(true);
    // Outside the HSK subset. iOS must not claim this glyph for the web font.
    expect(covers(hanzi, "烽".codePointAt(0)!)).toBe(false);
  });

  it("uses a sans CJK stack for study, review, and browse text", () => {
    const stack = css.slice(css.indexOf("--font-cjk-sans:"), css.indexOf("}", css.indexOf("--font-cjk-sans:")));
    expect(stack).toContain("PingFang SC");
    expect(stack).toContain("Hiragino Sans GB");
    expect(stack).toContain("Noto Sans SC");
    expect(stack).toContain("Microsoft YaHei");
    expect(stack).not.toContain("Songti");
    expect(stack).not.toContain("serif");
    for (const selector of [".hanzi-text", ".hanzi"]) {
      const start = css.indexOf(`${selector} {`);
      const rule = css.slice(start, css.indexOf("}", start));
      expect(rule).toContain("var(--font-cjk-sans)");
      expect(rule).not.toContain("Songti");
      expect(rule).not.toContain("--font-hanzi");
      expect(rule).not.toMatch(/[^-]serif/);
    }
    expect(css).not.toContain("Songti");
    expect(css).not.toContain("Noto Serif");
  });
});
