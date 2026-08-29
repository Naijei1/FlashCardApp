"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export default function NewDeckButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
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
    <form onSubmit={submit} className="flex gap-2">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Deck name, e.g. Chinese Lesson 1"
        className="min-w-0 flex-1 rounded-xl border border-border bg-surface px-4 py-3 outline-none focus:border-accent"
      />
      <button
        type="submit"
        disabled={busy || !name.trim()}
        className="rounded-xl bg-accent px-4 py-3 font-medium text-accent-foreground disabled:opacity-50"
      >
        Create
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="rounded-xl border border-border px-4 py-3 text-muted"
      >
        Cancel
      </button>
    </form>
  );
}
