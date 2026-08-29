"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Deck } from "@/lib/types";
import { LANGUAGE_OPTIONS } from "@/lib/languages";

export default function DeckSettings({ deck }: { deck: Deck }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(deck.name);
  const [frontLanguage, setFrontLanguage] = useState(deck.frontLanguage ?? "");
  const [backLanguage, setBackLanguage] = useState(deck.backLanguage ?? "");
  const [chineseSide, setChineseSide] = useState(deck.chineseSide ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const res = await fetch(`/api/decks/${deck.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, frontLanguage, backLanguage, chineseSide }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      setOpen(false);
      router.refresh();
    }
  }

  async function remove() {
    if (!confirm(`Delete deck "${deck.name}" and all of its cards?`)) return;
    setBusy(true);
    const res = await fetch(`/api/decks/${deck.id}`, { method: "DELETE" }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      router.push("/");
      router.refresh();
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg border border-border px-3 py-2 text-sm text-muted hover:text-foreground"
      >
        Edit deck
      </button>
    );
  }

  const selectClass =
    "w-full rounded-lg border border-border bg-surface px-3 py-2 outline-none focus:border-accent";

  return (
    <div className="w-full space-y-3 rounded-2xl border border-border bg-surface p-4">
      <label className="block text-sm">
        <span className="text-muted">Deck name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} className={selectClass + " mt-1"} />
      </label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="text-muted">Front language (speech)</span>
          <select
            value={frontLanguage}
            onChange={(e) => setFrontLanguage(e.target.value)}
            className={selectClass + " mt-1"}
          >
            {LANGUAGE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-muted">Back language (speech)</span>
          <select
            value={backLanguage}
            onChange={(e) => setBackLanguage(e.target.value)}
            className={selectClass + " mt-1"}
          >
            {LANGUAGE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block text-sm">
        <span className="text-muted">
          Chinese side for Write mode (used when no zh language is set above)
        </span>
        <select
          value={chineseSide}
          onChange={(e) => setChineseSide(e.target.value)}
          className={selectClass + " mt-1"}
        >
          <option value="">Auto (from languages)</option>
          <option value="front">Front</option>
          <option value="back">Back</option>
        </select>
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={save}
          disabled={busy || !name.trim()}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-50"
        >
          Save
        </button>
        <button
          onClick={() => setOpen(false)}
          className="rounded-lg border border-border px-4 py-2 text-sm text-muted"
        >
          Cancel
        </button>
        <button
          onClick={remove}
          disabled={busy}
          className="ml-auto rounded-lg border border-red-500/40 px-4 py-2 text-sm text-red-500"
        >
          Delete deck
        </button>
      </div>
    </div>
  );
}
