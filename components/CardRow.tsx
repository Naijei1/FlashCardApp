"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Card, Deck } from "@/lib/types";
import { formatInterval } from "@/lib/interval-label";
import { IconPencil } from "./icons";
import TtsButton from "./TtsButton";
import { DEFAULT_FRONT_LANG } from "@/lib/languages";

function dueLabel(card: Card): string {
  const diff = new Date(card.fsrs.due).getTime() - Date.now();
  if (card.fsrs.reps === 0) return "new";
  if (diff <= 0) return "due";
  return `in ${formatInterval(diff)}`;
}

export default function CardRow({
  card,
  decks,
  frontLang,
}: {
  card: Card;
  decks: Deck[];
  frontLang?: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [front, setFront] = useState(card.front);
  const [back, setBack] = useState(card.back);
  const [notes, setNotes] = useState(card.notes ?? "");
  const [moveTo, setMoveTo] = useState(card.deckId);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const res = await fetch(`/api/cards/${card.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deckId: card.deckId,
        front,
        back,
        notes,
        ...(moveTo !== card.deckId ? { moveToDeckId: moveTo } : {}),
      }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      setEditing(false);
      router.refresh();
    }
  }

  async function remove() {
    if (!confirm(`Delete card "${card.front}"?`)) return;
    setBusy(true);
    const res = await fetch(`/api/cards/${card.id}?deckId=${card.deckId}`, {
      method: "DELETE",
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) router.refresh();
  }

  const inputClass =
    "w-full rounded-lg border border-border bg-surface px-3 py-2 outline-none focus:border-accent";

  if (editing) {
    return (
      <div className="space-y-2 rounded-xl border border-accent/50 bg-surface p-3">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <input value={front} onChange={(e) => setFront(e.target.value)} className={inputClass} />
          <input value={back} onChange={(e) => setBack(e.target.value)} className={inputClass} />
        </div>
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes"
          className={inputClass}
        />
        {decks.length > 1 && (
          <label className="block text-sm text-muted">
            Deck
            <select
              value={moveTo}
              onChange={(e) => setMoveTo(e.target.value)}
              className={inputClass + " mt-1"}
            >
              {decks.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="flex gap-2">
          <button
            onClick={save}
            disabled={busy || !front.trim() || !back.trim()}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-50"
          >
            Save
          </button>
          <button
            onClick={() => setEditing(false)}
            className="rounded-lg border border-border px-4 py-2 text-sm text-muted"
          >
            Cancel
          </button>
          <button
            onClick={remove}
            disabled={busy}
            className="ml-auto rounded-lg border border-red-500/40 px-4 py-2 text-sm text-red-500"
          >
            Delete
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-xl border border-border bg-surface p-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-lg">{card.front}</span>
          <span className="text-muted">→</span>
          <span className="truncate text-muted">{card.back}</span>
        </div>
        {card.notes && <div className="truncate text-sm text-muted">{card.notes}</div>}
      </div>
      <span className="shrink-0 text-xs text-muted">{dueLabel(card)}</span>
      <TtsButton text={card.front} lang={frontLang || DEFAULT_FRONT_LANG} />
      <button
        onClick={() => setEditing(true)}
        aria-label={`Edit ${card.front}`}
        className="pressable flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg text-muted hover:bg-border/40 hover:text-foreground"
      >
        <IconPencil strokeWidth={1.8} />
      </button>
    </div>
  );
}
