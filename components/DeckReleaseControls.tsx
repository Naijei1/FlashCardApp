"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Deck } from "@/lib/types";
import { responseError } from "@/lib/response-error";

export default function DeckReleaseControls({ deck }: { deck: Deck }) {
  const router = useRouter();
  const [week, setWeek] = useState(deck.releaseWeek ? String(deck.releaseWeek) : "");
  const [releaseAt, setReleaseAt] = useState(deck.releaseAt ? deck.releaseAt.slice(0, 16) : "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (deck.source !== "global") return null;
  const label = deck.status === "published"
    ? "Visible to learners"
    : deck.status === "scheduled" && deck.releaseWeek
      ? `Scheduled as week ${deck.releaseWeek}`
      : "Draft — learners cannot see this yet";

  async function schedule() {
    setBusy(true);
    setError("");
    const response = await fetch(`/api/admin/decks/${encodeURIComponent(deck.id)}/schedule`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ releaseWeek: Number(week), releaseAt: new Date(releaseAt).toISOString() }),
    }).catch(() => null);
    setBusy(false);
    if (!response?.ok) {
      setError(await responseError(response, "Could not set the release date."));
      return;
    }
    router.refresh();
  }

  async function publishNow() {
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
      <p className="text-sm text-muted">{label}. The date is checked when someone studies. Nothing runs on a timer.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          Week number
          <input value={week} onChange={(event) => setWeek(event.target.value)} className="input mt-1" inputMode="numeric" />
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
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
    </section>
  );
}
