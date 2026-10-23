"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { responseError } from "@/lib/response-error";

type PreviewRow = { front: string; back: string; notes?: string };
type InvalidRow = { rowNumber: number; reason: string };

export default function AdminUploadWizard() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [invalid, setInvalid] = useState<InvalidRow[]>([]);
  const [deckId, setDeckId] = useState("");
  const [week, setWeek] = useState("");
  const [releaseAt, setReleaseAt] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState("");

  async function preview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = new FormData(event.currentTarget).get("csv");
    if (!(file instanceof File) || file.size === 0) return;
    setBusy(true);
    setError("");
    setSaved("");
    const csv = await file.text();
    const res = await fetch("/api/admin/uploads/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csv }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError(await responseError(res, "Could not preview that file."));
      return;
    }
    const body = await res.json();
    setRows(body.rows ?? []);
    setInvalid(body.invalid ?? []);
    setDeckId("");
  }

  async function saveDraft() {
    if (!name.trim() || rows.length === 0) return;
    setBusy(true);
    setError("");
    const res = await fetch("/api/admin/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), rows }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError(await responseError(res, "Could not save the draft."));
      return;
    }
    const body = await res.json();
    setDeckId(body.deckId);
    setSaved(`Saved ${body.created} cards as a draft. Learners cannot see it yet.`);
  }

  async function schedule() {
    if (!deckId || !week || !releaseAt) return;
    setBusy(true);
    setError("");
    const res = await fetch(`/api/admin/decks/${encodeURIComponent(deckId)}/schedule`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ releaseWeek: Number(week), releaseAt: new Date(releaseAt).toISOString() }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError(await responseError(res, "Could not set the release date."));
      return;
    }
    const body = await res.json();
    setSaved(`Scheduled ${body.releaseLabel ?? `week ${week}`}. It appears when that date arrives.`);
    router.refresh();
  }

  async function publishNow() {
    if (!deckId) return;
    setBusy(true);
    setError("");
    const res = await fetch(`/api/admin/decks/${encodeURIComponent(deckId)}/publish`, { method: "POST" }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError(await responseError(res, "Could not publish."));
      return;
    }
    setSaved("Published now. Learners can study these cards.");
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <form onSubmit={preview} className="card space-y-3 p-5">
        <h2 className="font-semibold">1. Preview CSV</h2>
        <input name="csv" type="file" accept=".csv,text/csv" className="block w-full text-sm" required />
        <button type="submit" disabled={busy} className="btn btn-secondary">Preview</button>
      </form>
      {invalid.length > 0 && (
        <p className="text-sm text-red-500">{invalid.length} rows need a fix before they can be saved.</p>
      )}
      {rows.length > 0 && (
        <section className="card space-y-3 p-5">
          <h2 className="font-semibold">2. Save draft</h2>
          <p className="text-sm text-muted">{rows.length} cards ready. Nothing is visible to learners until you schedule or publish.</p>
          <ul className="max-h-48 space-y-1 overflow-auto text-sm">
            {rows.slice(0, 8).map((row) => (
              <li key={`${row.front}-${row.back}`} className="truncate">{row.front} → {row.back}</li>
            ))}
          </ul>
          <label className="block text-sm">
            Deck name
            <input value={name} onChange={(event) => setName(event.target.value)} className="input mt-1" placeholder="Week 12" />
          </label>
          <button type="button" onClick={saveDraft} disabled={busy || !name.trim()} className="btn btn-primary">Save draft</button>
        </section>
      )}
      {deckId && (
        <section className="card space-y-3 p-5">
          <h2 className="font-semibold">3. Release</h2>
          <p className="text-sm text-muted">Week labels are for you. The date is checked whenever a learner opens the app. There is no scheduler.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              Week number
              <input value={week} onChange={(event) => setWeek(event.target.value)} inputMode="numeric" className="input mt-1" placeholder="12" />
            </label>
            <label className="block text-sm">
              Release date
              <input value={releaseAt} onChange={(event) => setReleaseAt(event.target.value)} type="datetime-local" className="input mt-1" />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={schedule} disabled={busy || !week || !releaseAt} className="btn btn-secondary">Set release date</button>
            <button type="button" onClick={publishNow} disabled={busy} className="btn btn-primary">Publish now</button>
          </div>
        </section>
      )}
      {saved && <p className="text-sm text-muted">{saved}</p>}
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
    </div>
  );
}
