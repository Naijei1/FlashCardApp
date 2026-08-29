export type CsvCardRow = {
  front: string;
  back: string;
  notes?: string;
  reverse?: boolean;
};

export type InvalidRow = {
  /** 1-based row number in the original file (header included in numbering). */
  rowNumber: number;
  cells: string[];
  reason: string;
};

export type ParsedCardCsv = {
  hasHeader: boolean;
  rows: CsvCardRow[];
  invalid: InvalidRow[];
  /** Count of rows whose flipped (back→front) pair also appears in the file. */
  flippedDuplicates: number;
};

/** RFC-4180 parser: quoted fields, "" escapes, embedded newlines, CRLF/LF, BOM. */
export function parseCsv(text: string): string[][] {
  let input = text;
  if (input.charCodeAt(0) === 0xfeff) input = input.slice(1);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < input.length) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        field += ch;
        i += 1;
      }
    } else if (ch === '"' && field === "") {
      inQuotes = true;
      i += 1;
    } else if (ch === ",") {
      endField();
      i += 1;
    } else if (ch === "\r" && input[i + 1] === "\n") {
      endRow();
      i += 2;
    } else if (ch === "\n" || ch === "\r") {
      endRow();
      i += 1;
    } else {
      field += ch;
      i += 1;
    }
  }
  if (field !== "" || row.length > 0) endRow();

  // Drop rows that are entirely empty (e.g. trailing blank lines).
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

const HEADER_NAMES = new Set(["front", "back", "notes", "reverse"]);

/**
 * Row 0 is a header iff every cell is a known column name and at least one
 * is front/back. Headerless files map columns to front, back, [notes].
 */
export function detectHeader(rows: string[][]): boolean {
  if (rows.length === 0) return false;
  const cells = rows[0].map((c) => c.trim().toLowerCase());
  return (
    cells.every((c) => HEADER_NAMES.has(c)) &&
    (cells.includes("front") || cells.includes("back"))
  );
}

function parseBool(value: string): boolean {
  return ["true", "1", "yes", "y"].includes(value.trim().toLowerCase());
}

export function parseCardCsv(text: string): ParsedCardCsv {
  const allRows = parseCsv(text);
  const hasHeader = detectHeader(allRows);

  let columns = ["front", "back", "notes"];
  let dataRows = allRows;
  let rowOffset = 1;
  if (hasHeader) {
    columns = allRows[0].map((c) => c.trim().toLowerCase());
    dataRows = allRows.slice(1);
    rowOffset = 2;
  }

  const rows: CsvCardRow[] = [];
  const invalid: InvalidRow[] = [];

  dataRows.forEach((cells, index) => {
    const get = (name: string) => {
      const col = columns.indexOf(name);
      return col >= 0 && col < cells.length ? cells[col].trim() : "";
    };
    const front = get("front");
    const back = get("back");
    if (!front || !back) {
      invalid.push({
        rowNumber: index + rowOffset,
        cells,
        reason: !front && !back ? "missing front and back" : !front ? "missing front" : "missing back",
      });
      return;
    }
    const notes = get("notes");
    const reverse = get("reverse");
    rows.push({
      front,
      back,
      ...(notes ? { notes } : {}),
      ...(reverse ? { reverse: parseBool(reverse) } : {}),
    });
  });

  const pairs = new Set(rows.map((r) => r.front + "\u0000" + r.back));
  const flippedDuplicates = rows.filter((r) =>
    pairs.has(r.back + "\u0000" + r.front)
  ).length;

  return { hasHeader, rows, invalid, flippedDuplicates };
}

function escapeField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

export function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map(escapeField).join(",")).join("\n") + "\n";
}
