"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { responseError } from "@/lib/response-error";

export default function NewDeckButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setError("");
    setBusy(true);
    const res = await fetch("/api/decks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      setName("");
      setOpen(false);
      router.refresh();
    } else {
      setError(await responseError(res, "Could not create that deck."));
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full rounded-xl border border-dashed border-border px-4 py-3 text-muted hover:border-accent hover:text-accent"
      >
        + New Deck
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="flex gap-2">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Deck name</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Deck name, e.g. Chinese Lesson 1"
            className="w-full rounded-xl border border-border bg-surface px-4 py-3 outline-none focus:border-accent"
          />
        </label>
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="rounded-xl bg-accent px-4 py-3 font-medium text-accent-foreground disabled:opacity-50"
        >
          {busy ? "Creating…" : "Create"}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setName(""); setError(""); }}
          className="rounded-xl border border-border px-4 py-3 text-muted"
        >
          Cancel
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
    </form>
  );
}
