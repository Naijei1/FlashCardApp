import { describe, expect, it } from "vitest";
import {
  detectHeader,
  parseCardCsv,
  parseCsv,
  spreadsheetSafeField,
  toCsv,
} from "@/lib/csv";

describe("parseCsv", () => {
  it("parses simple rows", () => {
    expect(parseCsv("你好,hello\n老师,teacher\n")).toEqual([
      ["你好", "hello"],
      ["老师", "teacher"],
    ]);
  });

  it("handles quoted commas", () => {
    expect(parseCsv('耳,"Ear(Radical, Word) — Ěr"')).toEqual([
      ["耳", "Ear(Radical, Word) — Ěr"],
    ]);
  });

  it("handles escaped quotes", () => {
    expect(parseCsv('a,"say ""hi"""')).toEqual([["a", 'say "hi"']]);
  });

  it("handles multi-line quoted fields (sample file row)", () => {
    const text = '足,"Foot(radical, word) — Zù — Think soccor\nEnough(word)"\n';
    expect(parseCsv(text)).toEqual([
      ["足", "Foot(radical, word) — Zù — Think soccor\nEnough(word)"],
    ]);
  });

  it("handles CRLF line endings", () => {
    expect(parseCsv("a,b\r\nc,d\r\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("strips a UTF-8 BOM", () => {
    expect(parseCsv("﻿front,back\n你好,hello")).toEqual([
      ["front", "back"],
      ["你好", "hello"],
    ]);
  });

  it("drops blank lines", () => {
    expect(parseCsv("a,b\n\n\nc,d\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("rejects an unterminated quoted field", () => {
    expect(() => parseCsv('a,"b\nc,d')).toThrow("Unterminated quoted CSV field");
  });
});

describe("detectHeader", () => {
  it("detects a front,back header", () => {
    expect(detectHeader([["front", "back"], ["你好", "hello"]])).toBe(true);
  });

  it("detects front,back,notes,reverse", () => {
    expect(detectHeader([["Front", "Back", "Notes", "Reverse"]])).toBe(true);
  });

  it("treats data-first files as headerless", () => {
    expect(detectHeader([["你好", "hello"]])).toBe(false);
  });

  it("does not treat notes,reverse alone as a header", () => {
    expect(detectHeader([["notes", "reverse"]])).toBe(false);
  });

  it("allows extra columns in a header", () => {
    expect(detectHeader([["front", "back", "tags"]])).toBe(true);
  });
});

describe("parseCardCsv", () => {
  it("parses a headered file with notes and reverse", () => {
    const result = parseCardCsv(
      "front,back,notes,reverse\n你好,hello,greeting,true\n老师,teacher,,false\n"
    );
    expect(result.hasHeader).toBe(true);
    expect(result.rows).toEqual([
      { front: "你好", back: "hello", notes: "greeting", reverse: true },
      { front: "老师", back: "teacher", reverse: false },
    ]);
    expect(result.invalid).toEqual([]);
  });

  it("parses a headerless file", () => {
    const result = parseCardCsv("你好,hello\n老师,teacher\n");
    expect(result.hasHeader).toBe(false);
    expect(result.rows).toHaveLength(2);
  });

  it("supports the optional reverse column without a header", () => {
    const result = parseCardCsv("hello,你好,greeting,true\nteacher,老师,,false\n");
    expect(result.hasHeader).toBe(false);
    expect(result.rows).toEqual([
      { front: "hello", back: "你好", notes: "greeting", reverse: true },
      { front: "teacher", back: "老师", reverse: false },
    ]);
  });

  it("reports invalid rows with 1-based row numbers", () => {
    const result = parseCardCsv("front,back\n你好,hello\n,missing\n");
    expect(result.rows).toHaveLength(1);
    expect(result.invalid).toEqual([
      { rowNumber: 3, cells: ["", "missing"], reason: "missing front" },
    ]);
  });

  it("keeps original row numbers after blank records", () => {
    const result = parseCardCsv("front,back\n\n你好,hello\n,missing\n");
    expect(result.invalid[0]?.rowNumber).toBe(4);
  });

  it("counts flipped duplicate pairs (both-directions file)", () => {
    const result = parseCardCsv("你好,hello\nhello,你好\n老师,teacher\n");
    expect(result.flippedDuplicates).toBe(2);
  });

  it("ignores unknown header columns instead of importing the header", () => {
    const result = parseCardCsv("front,back,tags\n\u4f60\u597d,hello,greeting\n");
    expect(result.hasHeader).toBe(true);
    expect(result.rows).toEqual([{ front: "\u4f60\u597d", back: "hello" }]);
  });
});

describe("toCsv", () => {
  it("neutralizes spreadsheet formulas without breaking CSV re-import trimming", () => {
    expect(["=1+1", "+cmd", "-2", "@sum", "safe"].map(spreadsheetSafeField)).toEqual([
      "\t=1+1",
      "\t+cmd",
      "\t-2",
      "\t@sum",
      "safe",
    ]);
  });
  it("quotes fields containing commas, quotes, and newlines", () => {
    expect(toCsv([["a,b", 'say "hi"', "line1\nline2"]])).toBe(
      '"a,b","say ""hi""","line1\nline2"\n'
    );
  });

  it("round-trips through parseCsv", () => {
    const rows = [
      ["你好", "hello, world", 'quote " here'],
      ["足", "multi\nline"],
    ];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});
