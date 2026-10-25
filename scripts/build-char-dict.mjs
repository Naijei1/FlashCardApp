/**
 * Builds data/char-dict.ts from the Unicode Han Database.
 *
 * Source (free, redistributable, no API key):
 *   https://www.unicode.org/Public/UCD/latest/ucd/Unihan.zip
 *   https://www.unicode.org/Public/UCD/latest/ucd/CJKRadicals.txt
 * Fields: kDefinition (English gloss) and kRSUnicode (Kangxi radical index).
 * Radical characters are the unified ideographs in CJKRadicals.txt.
 * License: data/UNICODE-LICENSE.txt
 *
 * Only BMP unified ideographs (U+4E00–U+9FFF) are kept, and only the short
 * gloss plus radical index, so the study lookup stays a few hundred KB.
 *
 * Usage: node scripts/build-char-dict.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outPath = path.join(root, "data", "char-dict.ts");
const UNIHAN = "https://www.unicode.org/Public/UCD/latest/ucd/Unihan.zip";
const RADICALS = "https://www.unicode.org/Public/UCD/latest/ucd/CJKRadicals.txt";

// Unihan's own gloss for these radicals is only "Kangxi radical N".
const RADICAL_NAME = {
  "35": "go slowly",
  "138": "stopping",
};

function shortGloss(value) {
  let text = value.replace(/\s+/g, " ").trim().replace(/^(?:\([^)]*\)\s*)+/, "");
  let clause = (text.split(";")[0] ?? "").replace(/\s*\([^)]*\)/g, "").trim();
  if (clause.length > 72) {
    const bits = clause.split(",").map((bit) => bit.trim()).filter(Boolean);
    clause = bits[0] ?? "";
    for (const bit of bits.slice(1)) {
      const next = `${clause}, ${bit}`;
      if (next.length > 72) break;
      clause = next;
    }
  }
  return clause.replace(/^[, ]+|[, ]+$/g, "");
}

function radicalMeaning(gloss) {
  const first = gloss.split(",")[0]?.trim() ?? "";
  if (!first || /radical/i.test(first)) return "";
  if (first.length <= 32) return first;
  let kept = "";
  for (const word of first.split(" ")) {
    const next = kept ? `${kept} ${word}` : word;
    if (next.length > 32) break;
    kept = next;
  }
  return kept;
}

function radicalKey(rs) {
  const first = rs.trim().split(/\s+/)[0] ?? "";
  return /^(\d+'*)/.exec(first)?.[1] ?? "";
}

function codepoint(cp) {
  return Number.parseInt(cp.slice(2), 16);
}

function inBasicHan(cp) {
  const value = codepoint(cp);
  return value >= 0x4e00 && value <= 0x9fff;
}

async function download(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download ${url}: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

const dir = mkdtempSync(path.join(tmpdir(), "unihan-"));
try {
  const zipPath = path.join(dir, "Unihan.zip");
  writeFileSync(zipPath, await download(UNIHAN));
  execFileSync("unzip", ["-q", zipPath, "Unihan_Readings.txt", "Unihan_IRGSources.txt", "-d", dir]);
  const radicalsText = (await download(RADICALS)).toString("utf8");
  const readings = readFileSync(path.join(dir, "Unihan_Readings.txt"), "utf8");
  const sources = readFileSync(path.join(dir, "Unihan_IRGSources.txt"), "utf8");

  const definitions = new Map();
  const mandarin = new Set();
  for (const line of readings.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const [cp, field, value] = line.split("\t");
    if (!cp || !field || !value || !inBasicHan(cp)) continue;
    if (field === "kDefinition") definitions.set(cp, value);
    else if (field === "kMandarin") mandarin.add(cp);
  }

  const radicals = new Map();
  for (const line of sources.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const [cp, field, value] = line.split("\t");
    if (field !== "kRSUnicode" || !cp || !value || !inBasicHan(cp)) continue;
    const key = radicalKey(value);
    if (key) radicals.set(cp, key);
  }

  const radicalChars = new Map();
  for (const line of radicalsText.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const [key, , unified] = line.split(";").map((part) => part.trim());
    if (!key || !unified) continue;
    radicalChars.set(key, String.fromCodePoint(Number.parseInt(unified, 16)));
  }

  const radicalTable = {};
  for (const [key, character] of radicalChars) {
    const cp = `U+${character.codePointAt(0).toString(16).toUpperCase()}`;
    const gloss = definitions.has(cp) ? shortGloss(definitions.get(cp)) : "";
    radicalTable[key] = [character, RADICAL_NAME[key] ?? radicalMeaning(gloss)];
  }
  for (const [key, row] of Object.entries(radicalTable)) {
    if (row[1]) continue;
    const base = /^(\d+)/.exec(key)?.[1];
    const fallback = base && base !== key ? radicalTable[base]?.[1] : "";
    if (fallback) row[1] = fallback;
  }

  const chars = {};
  const points = new Set([...definitions.keys(), ...mandarin]);
  for (const cp of points) {
    if (!inBasicHan(cp)) continue;
    const gloss = definitions.has(cp) ? shortGloss(definitions.get(cp)) : "";
    const key = radicals.get(cp) ?? "";
    if (!gloss && !key) continue;
    chars[String.fromCodePoint(codepoint(cp))] = [gloss, key];
  }

  const orderedRadicals = Object.fromEntries(
    Object.entries(radicalTable).sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true }))
  );
  const orderedChars = Object.fromEntries(
    Object.entries(chars).sort(([a], [b]) => a.codePointAt(0) - b.codePointAt(0))
  );
  const payload = { radicals: orderedRadicals, chars: orderedChars };
  const file = `// Generated by scripts/build-char-dict.mjs from the Unicode Han Database
// (kDefinition, kRSUnicode) and CJKRadicals.txt. Do not edit by hand.
// License: data/UNICODE-LICENSE.txt
export const CHAR_DICT_JSON = ${JSON.stringify(JSON.stringify(payload))};
`;
  writeFileSync(outPath, file);
  console.log(
    `Wrote ${Object.keys(orderedChars).length} characters and ${Object.keys(orderedRadicals).length} radicals to ${outPath}`
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
