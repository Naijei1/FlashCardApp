"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatZonedDateTimeLocal, parseZonedDateTimeLocal } from "@/lib/forecast";
import type { Deck } from "@/lib/types";
import { responseError } from "@/lib/response-error";

export default function DeckReleaseControls({
  deck,
  timeZone,
  released,
}: {
  deck: Deck;
  timeZone: string;
  released: boolean;
}) {
  const router = useRouter();
  const [week, setWeek] = useState(deck.releaseWeek ? String(deck.releaseWeek) : "");
  const [releaseAt, setReleaseAt] = useState(
    deck.releaseAt && Number.isFinite(Date.parse(deck.releaseAt))
      ? formatZonedDateTimeLocal(new Date(deck.releaseAt), timeZone)
      : ""
  );
  const [confirmHide, setConfirmHide] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (deck.source !== "global") return null;
  const label = deck.status === "published"
    ? "Visible to learners"
    : deck.status === "scheduled" && deck.releaseWeek
      ? `Scheduled as week ${deck.releaseWeek}`
      : "Draft — learners cannot see this yet";
  const shownRelease = deck.releaseAt && Number.isFinite(Date.parse(deck.releaseAt))
    ? formatZonedDateTimeLocal(new Date(deck.releaseAt), timeZone).replace("T", " ")
    : "";

  async function schedule() {
    const iso = parseZonedDateTimeLocal(releaseAt, timeZone);
    if (!iso) {
      setError(`Enter a release date and time in ${timeZone}.`);
      return;
    }
    if (released && !confirmHide) {
      setError("This deck is already visible. Confirm before hiding it until a new date.");
      return;
    }
    setBusy(true);
    setError("");
    const response = await fetch(`/api/admin/decks/${encodeURIComponent(deck.id)}/schedule`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ releaseWeek: Number(week), releaseAt: iso, confirmHide: released && confirmHide }),
    }).catch(() => null);
    setBusy(false);
    if (!response?.ok) {
      setError(await responseError(response, "Could not set the release date."));
      return;
    }
    setConfirmHide(false);
    router.refresh();
  }

  async function publishNow() {
    if (released) return;
    setBusy(true);
    setError("");
    const response = await fetch(`/api/admin/decks/${encodeURIComponent(deck.id)}/publish`, { method: "POST" }).catch(() => null);
    setBusy(false);
    if (!response?.ok) {
      setError(await responseError(response, "Could not publish."));
      return;
    }
    router.refresh();
  }

  return (
    <section className="card space-y-3 p-5">
      <h2 className="font-semibold">Release</h2>
      <p className="text-sm text-muted">
        {label}. Times use {timeZone}. The date is checked when someone studies. Nothing runs on a timer.
      </p>
      {shownRelease && (
        <p className="text-sm text-muted">Current release: {shownRelease} ({timeZone})</p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          Week number
          <input value={week} onChange={(event) => setWeek(event.target.value)} className="input mt-1" inputMode="numeric" />
        </label>
        <label className="block text-sm">
          Release date ({timeZone})
          <input value={releaseAt} onChange={(event) => setReleaseAt(event.target.value)} type="datetime-local" className="input mt-1" />
        </label>
      </div>
      {released && (
        <label className="check-row text-sm">
          <input
            type="checkbox"
            className="checkbox"
            checked={confirmHide}
            onChange={(event) => setConfirmHide(event.target.checked)}
          />
          Hide this deck from learners until the new date
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={schedule}
          disabled={busy || !week || !releaseAt || (released && !confirmHide)}
          className={released ? "btn btn-secondary" : "btn btn-primary"}
        >
          Set release date
        </button>
        {!released && (
          <button type="button" onClick={publishNow} disabled={busy} className="btn btn-secondary">
            Publish now
          </button>
        )}
      </div>
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
    </section>
  );
}
