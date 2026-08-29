"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export default function AddCardForm({ deckId }: { deckId: string }) {
  const router = useRouter();
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [notes, setNotes] = useState("");
  const [reverse, setReverse] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const res = await fetch("/api/cards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deckId, front, back, notes, reverse }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      setFront("");
      setBack("");
      setNotes("");
      router.refresh();
    }
  }

  const inputClass =
    "w-full rounded-lg border border-border bg-surface px-3 py-2.5 outline-none focus:border-accent";

  return (
    <form onSubmit={submit} className="space-y-3 rounded-2xl border border-border bg-surface p-4">
      <h3 className="text-sm font-medium uppercase tracking-wide text-muted">Add card</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <input
          value={front}
          onChange={(e) => setFront(e.target.value)}
          placeholder="Front, e.g. 你好"
          className={inputClass}
        />
        <input
          value={back}
          onChange={(e) => setBack(e.target.value)}
          placeholder="Back, e.g. hello"
          className={inputClass}
        />
      </div>
      <input
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes (optional)"
        className={inputClass}
      />
      <div className="flex items-center justify-between gap-3">
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={reverse}
            onChange={(e) => setReverse(e.target.checked)}
            className="h-5 w-5 accent-[var(--accent)]"
          />
          Create reverse card
        </label>
        <button
          type="submit"
          disabled={busy || !front.trim() || !back.trim()}
          className="rounded-lg bg-accent px-5 py-2.5 font-medium text-accent-foreground disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </form>
  );
}
