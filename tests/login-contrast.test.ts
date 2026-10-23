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
});
