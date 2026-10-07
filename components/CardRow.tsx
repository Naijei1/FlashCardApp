"use client";
import HardWordButton from "./HardWordButton";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Card, Deck } from "@/lib/types";
import { formatInterval } from "@/lib/interval-label";
import { preventImeSubmit } from "@/lib/ime";
import { responseError } from "@/lib/response-error";
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
  const [saveError, setSaveError] = useState("");
  const committed = useRef({
    front: card.front,
    back: card.back,
    notes: card.notes ?? "",
    deckId: card.deckId,
  });

  // A server refresh can replace this card without remounting the row. Keep
  // Cancel's source of truth aligned with the latest canonical props.
  useEffect(() => {
    committed.current = {
      front: card.front,
      back: card.back,
      notes: card.notes ?? "",
      deckId: card.deckId,
    };
  }, [card.back, card.deckId, card.front, card.notes]);

  function resetDraft() {
    setFront(committed.current.front);
    setBack(committed.current.back);
    setNotes(committed.current.notes);
    setMoveTo(committed.current.deckId);
    setSaveError("");
  }

  function startEditing() {
    resetDraft();
    setEditing(true);
  }

  function cancelEditing() {
    resetDraft();
    setEditing(false);
  }

  async function save() {
    if (busy || !front.trim() || !back.trim()) return;
    setBusy(true);
    setSaveError("");
    const res = await fetch(`/api/cards/${encodeURIComponent(card.id)}`, {
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
      const saved = (await res.json().catch(() => null)) as Card | null;
      if (saved) {
        committed.current = {
          front: saved.front,
          back: saved.back,
          notes: saved.notes ?? "",
          deckId: saved.deckId,
        };
        setFront(saved.front);
        setBack(saved.back);
        setNotes(saved.notes ?? "");
        setMoveTo(saved.deckId);
      }
      setEditing(false);
      router.refresh();
    } else {
      setSaveError(await responseError(res, "Could not save this card. Try again."));
      if (res?.status === 409) router.refresh();
    }
  }

  async function remove() {
    if (busy) return;
    if (!confirm(`Delete card "${card.front}"?`)) return;
    setBusy(true);
    setSaveError("");
    const res = await fetch(`/api/cards/${encodeURIComponent(card.id)}?deckId=${encodeURIComponent(card.deckId)}`, {
      method: "DELETE",
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      router.refresh();
    } else {
      setSaveError(await responseError(res, "Could not delete this card. Try again."));
    }
  }


  if (editing) {
    return (
      <form
        aria-label={`Edit card ${card.front}`}
        aria-busy={busy}
        onKeyDown={preventImeSubmit}
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          void save();
        }}
        className="card space-y-2 border-accent/50 p-3"
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <input
            aria-label="Card front"
            value={front}
            onChange={(e) => setFront(e.target.value)}
            className="input"
          />
          <input
            aria-label="Card back"
            value={back}
            onChange={(e) => setBack(e.target.value)}
            className="input"
          />
        </div>
        <input
          aria-label="Card notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes"
          className="input"
        />
        {saveError && (
          <p role="alert" className="text-sm text-red-500">
            {saveError}
          </p>
        )}
        {decks.length > 1 && (
          <label className="block text-sm text-muted">
            Deck
            <select
              value={moveTo}
              onChange={(e) => setMoveTo(e.target.value)}
              className="input mt-1"
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
            type="submit"
            disabled={busy || !front.trim() || !back.trim()}
            className="btn btn-primary"
          >
            Save
          </button>
          <button
            type="button"
            onClick={cancelEditing}
            disabled={busy}
            className="btn btn-secondary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className="btn btn-danger ml-auto"
          >
            Delete
          </button>
        </div>
      </form>
    );
  }

  return (
    <article className="card flex items-center gap-2 py-2.5 pr-1.5 pl-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-lg font-medium">{card.front}</span>
          <span aria-hidden="true" className="text-muted">
            →
          </span>
          <span className="truncate text-muted">{card.back}</span>
        </div>
        {card.notes && <div className="truncate text-sm text-muted">{card.notes}</div>}
      </div>
      <HardWordButton key={`${card.deckId}:${card.id}:${!!card.hard}`} card={card} />
      <time dateTime={card.fsrs.due} className={`w-14 shrink-0 rounded-full px-2 py-0.5 text-center text-xs tabular-nums ${
        dueLabel(card) === "due" ? "bg-accent/10 font-medium text-accent" : "text-muted"
      }`}>
        {dueLabel(card)}
      </time>
      <TtsButton text={card.front} lang={frontLang || DEFAULT_FRONT_LANG} />
      <button
        type="button"
        onClick={startEditing}
        aria-label={`Edit ${card.front}`}
        className="pressable flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg text-muted hover:bg-surface-muted hover:text-foreground"
      >
        <IconPencil strokeWidth={1.8} />
      </button>
    </article>
  );
}
