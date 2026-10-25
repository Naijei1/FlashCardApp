import { statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { characterGloss } from "@/lib/char-dict";
import { characterDetails } from "@/lib/character-lookup";

describe("offline character dictionary", () => {
  it("stays a compact lookup instead of a full Unihan dump", () => {
    expect(statSync("data/char-dict.ts").size).toBeLessThan(800_000);
  });

  it("returns a short gloss and the Kangxi radical when Unihan has them", () => {
    expect(characterGloss("火")).toEqual({
      gloss: "fire, flame",
      radical: { number: 86, character: "火", meaning: "fire" },
    });
    expect(characterGloss("烽")).toEqual({
      gloss: "signal fire",
      radical: { number: 86, character: "火", meaning: "fire" },
    });
    expect(characterGloss("语")?.radical).toEqual({ number: 149, character: "讠", meaning: "words" });
    expect(characterGloss("語")?.radical).toEqual({ number: 149, character: "言", meaning: "words" });
  });

  it("omits a section when the character is not a single ideograph in the dictionary", () => {
    expect(characterGloss("〇")).toBeUndefined();
    expect(characterGloss("学生")).toBeUndefined();
    expect(characterGloss("A")).toBeUndefined();
    expect(characterGloss("")).toBeUndefined();
  });

  it("adds the reading next to the gloss without dropping either", () => {
    expect(characterDetails("火")).toMatchObject({
      pinyin: "huǒ",
      gloss: "fire, flame",
      radical: { number: 86, character: "火" },
    });
    expect(characterDetails("〇")).toEqual({ pinyin: "líng" });
    expect(characterDetails("A")).toEqual({});
  });
});
