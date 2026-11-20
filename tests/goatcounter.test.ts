import { describe, expect, it } from "vitest";
import { isAnalyticsHost, normalizeAnalyticsPath } from "../app/goatcounter";

describe("GoatCounter hostname gate", () => {
  it("allows the production hostname", () => {
    expect(isAnalyticsHost("flashcards.naijei.com")).toBe(true);
  });

  it.each([
    "", "localhost", "127.0.0.1", "192.168.1.10", "preview.amplifyapp.com",
    "admin.naijei.com", "naijei.com", "flashcards.naijei.com.example.com",
  ])("rejects %j", (hostname) => {
    expect(isAnalyticsHost(hostname)).toBe(false);
  });
});

describe("GoatCounter path normalization", () => {
  it.each([
    ["/", "/"],
    ["/groups/new/", "/groups/new"],
    ["/decks/user%40example.com", "/decks/:id"],
    ["/study/123456789012", "/study/:id"],
    ["/review/5e1e7023-681b-49ba-b57c-9cb48759ddcc", "/review/:id"],
    ["/write/deadbeef01234567", "/write/:id"],
    ["/pinyin/private-deck", "/pinyin/:id"],
    ["/groups/group-name", "/groups/:id"],
    ["/cram/share-code", "/cram/:id"],
    ["/unknown/private-name", "/other"],
    ["/decks/private-name/extra", "/other"],
  ])("normalizes %s to %s", (pathname, expected) => {
    expect(normalizeAnalyticsPath(pathname)).toBe(expected);
  });
});
