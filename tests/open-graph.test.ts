import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("LinkedIn link preview", () => {
  const layout = readFileSync("app/layout.tsx", "utf8");
  const middleware = readFileSync("middleware.ts", "utf8");
  const image = readFileSync("public/og-image.png");

  it("keeps the existing title and description and resolves absolute URLs from metadataBase", () => {
    expect(layout).toContain('title: "Chinese Flashcards"');
    expect(layout).toContain("Personal flashcards with FSRS spaced repetition");
    expect(layout).toContain('new URL("https://flashcards.naijei.com")');
    expect(layout).toContain('url: "/og-image.png"');
    expect(layout).toContain("width: 1200");
    expect(layout).toContain("height: 627");
    expect(layout).toContain('type: "website"');
    expect(layout).toContain('card: "summary_large_image"');
  });

  it("serves a public 1200x627 PNG under 1MB", () => {
    expect(image.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(image.readUInt32BE(16)).toBe(1200);
    expect(image.readUInt32BE(20)).toBe(627);
    expect(image.length).toBeLessThan(1_000_000);
  });

  it("rewrites only the site root for link-preview crawlers", () => {
    expect(middleware).toContain("LinkedInBot");
    expect(middleware).toMatch(/matcher:\s*\[\s*"\/"\s*\]/);
    expect(middleware).toContain('url.pathname = "/login"');
    expect(middleware).not.toContain("og-image");
  });
});
