import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function channel(hex: string, shift: number): number {
  const value = ((Number.parseInt(hex.slice(1), 16) >> shift) & 255) / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function contrast(foreground: string, background: string): number {
  const luminance = (hex: string) =>
    0.2126 * channel(hex, 16) + 0.7152 * channel(hex, 8) + 0.0722 * channel(hex, 0);
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

describe("login contrast", () => {
  it("keeps error text and the disabled Unlock button at WCAG AA", () => {
    const css = readFileSync("app/globals.css", "utf8");
    expect(css).not.toContain("disabled:opacity-40");
    expect(css).toContain("color: #9f1239");
    expect(css).toContain("color: #44403c !important");
    expect(contrast("#9f1239", "#f6f5f3")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#fecdd3", "#0f0e0d")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#44403c", "#e7e5e4")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#f5f5f4", "#57534e")).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps muted labels dark enough on the page background and card surfaces", () => {
    const css = readFileSync("app/globals.css", "utf8");
    const shell = readFileSync("components/AppShell.tsx", "utf8");
    const ratings = readFileSync("components/RatingBar.tsx", "utf8");
    const row = readFileSync("components/CardRow.tsx", "utf8");
    expect(css).toContain("--muted: #57534e");
    expect(css).toContain("--muted: #c8c2bb");
    expect(contrast("#57534e", "#f6f5f3")).toBeGreaterThanOrEqual(7);
    expect(contrast("#57534e", "#ffffff")).toBeGreaterThanOrEqual(7);
    expect(contrast("#c8c2bb", "#0f0e0d")).toBeGreaterThanOrEqual(7);
    expect(contrast("#c8c2bb", "#1a1918")).toBeGreaterThanOrEqual(7);
    expect(contrast("#c8c2bb", "#232120")).toBeGreaterThanOrEqual(7);
    expect(shell).toContain("lg:max-w-5xl xl:max-w-6xl");
    expect(ratings).not.toContain("opacity-70");
    expect(row).toContain("text-foreground");
    expect(row).not.toContain("text-xs text-muted");
  });
});
