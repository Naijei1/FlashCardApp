"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { parseCardCsv, type ParsedCardCsv } from "@/lib/csv";
import { responseError } from "@/lib/response-error";
import type { Deck } from "@/lib/types";

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_IMPORT_ROWS = 2_000;

export default function ImportWizard({
  decks,
  initialDeckId,
}: {
  decks: Deck[];
  initialDeckId?: string;
}) {
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<ParsedCardCsv | null>(null);
  const [deckId, setDeckId] = useState(
    initialDeckId && decks.some((d) => d.id === initialDeckId)
      ? initialDeckId
      : decks[0]?.id ?? ""
  );
  const [reverse, setReverse] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<number | null>(null);
  const [error, setError] = useState("");
  const readGeneration = useRef(0);
  const importId = useRef("");
  const fileInput = useRef<HTMLInputElement>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    const generation = ++readGeneration.current;
    setFileName(file.name);
    setResult(null);
    setError("");
    setParsed(null);
    if (file.size > MAX_FILE_BYTES) {
      setError("CSV files are limited to 8 MB.");
      if (fileInput.current) fileInput.current.value = "";
      return;
    }
    try {
      const text = await file.text();
      if (generation !== readGeneration.current) return;
      const parsedFile = parseCardCsv(text);
      if (parsedFile.rows.length > MAX_IMPORT_ROWS) {
        setError(`Imports are limited to ${MAX_IMPORT_ROWS.toLocaleString()} valid rows.`);
        if (fileInput.current) fileInput.current.value = "";
        return;
      }
      importId.current = crypto.randomUUID();
      setParsed(parsedFile);
    } catch (cause) {
      if (generation !== readGeneration.current) return;
      setError(cause instanceof Error ? cause.message : "Could not read that CSV file.");
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function doImport() {
    if (!parsed || !deckId || parsed.rows.length === 0) return;
    setBusy(true);
    setError("");
    const res = await fetch("/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deckId,
        rows: parsed.rows,
        reverse,
        importId: importId.current || crypto.randomUUID(),
      }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      const data = await res.json();
      setResult(data.created);
      setParsed(null);
      setFileName("");
      importId.current = "";
      if (fileInput.current) fileInput.current.value = "";
    } else {
      setError(
        await responseError(res, "Import failed — check your connection and try again.")
      );
    }
  }

  const inputClass =
    "w-full rounded-lg border border-border bg-surface px-3 py-2.5 outline-none focus:border-accent";

  if (decks.length === 0) {
    return (
      <p className="text-muted">
        Create a deck on the <Link href="/" className="text-accent underline">home page</Link>{" "}
        first, then import into it.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <label className="block">
        <span className="mb-1 block text-sm text-muted">
          CSV file — columns front, back, optional notes/reverse; a header row is optional
        </span>
        <input
          ref={fileInput}
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => onFile(e.target.files?.[0])}
          className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-accent file:px-4 file:py-2.5 file:font-medium file:text-accent-foreground"
        />
      </label>

      {result !== null && (
        <p className="rounded-xl border border-green-600/40 bg-surface p-4 text-green-600">
          Imported {result} card{result === 1 ? "" : "s"}
        </p>
      )}
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}

      {parsed && (
        <>
          <div className="rounded-2xl border border-border bg-surface p-4 text-sm">
            <p>
              <strong>{fileName}</strong>: {parsed.rows.length} valid row
              {parsed.rows.length === 1 ? "" : "s"}
              {parsed.hasHeader ? " (header detected)" : " (no header)"}
              {parsed.invalid.length > 0 && `, ${parsed.invalid.length} invalid`}
            </p>
            {parsed.flippedDuplicates > 0 && (
              <p className="mt-2 text-amber-500">
                ⚠ {parsed.flippedDuplicates} rows already have their reversed pair in this
                file — leave “create reverse cards” off to avoid duplicates.
              </p>
            )}
          </div>

          {parsed.invalid.length > 0 && (
            <div className="rounded-2xl border border-red-500/40 bg-surface p-4 text-sm">
              <p className="mb-2 font-medium text-red-500">Skipped rows</p>
              <ul className="space-y-1 text-muted">
                {parsed.invalid.slice(0, 10).map((row) => (
                  <li key={row.rowNumber}>
                    Row {row.rowNumber}: {row.reason} — {row.cells.join(", ").slice(0, 60)}
                  </li>
                ))}
                {parsed.invalid.length > 10 && <li>… and {parsed.invalid.length - 10} more</li>}
              </ul>
            </div>
          )}

          <div className="max-h-72 overflow-y-auto rounded-2xl border border-border bg-surface">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface text-left text-muted">
                <tr>
                  <th className="p-2 font-medium">Front</th>
                  <th className="p-2 font-medium">Back</th>
                  <th className="p-2 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody>
                {parsed.rows.slice(0, 50).map((row, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="p-2">{row.front}</td>
                    <td className="p-2">{row.back}</td>
                    <td className="p-2 text-muted">{row.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {parsed.rows.length > 50 && (
              <p className="p-2 text-center text-xs text-muted">
                … {parsed.rows.length - 50} more rows
              </p>
            )}
          </div>

          <label className="block text-sm">
            <span className="text-muted">Import into deck</span>
            <select
              value={deckId}
              onChange={(e) => setDeckId(e.target.value)}
              className={inputClass + " mt-1"}
            >
              {decks.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={reverse}
              onChange={(e) => setReverse(e.target.checked)}
              className="h-5 w-5 accent-[var(--accent)]"
            />
            Also create reverse cards (back → front)
          </label>

          <button
            type="button"
            onClick={doImport}
            disabled={busy || parsed.rows.length === 0}
            className="w-full rounded-xl bg-accent px-4 py-3 text-lg font-medium text-accent-foreground disabled:opacity-50"
          >
            {busy
              ? "Importing…"
              : `Import ${parsed.rows.reduce(
                  (count, row) =>
                    count + ((typeof row.reverse === "boolean" ? row.reverse : reverse) ? 2 : 1),
                  0
                )} cards`}
          </button>
        </>
      )}
    </div>
  );
}
