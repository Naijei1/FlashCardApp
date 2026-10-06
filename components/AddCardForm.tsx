"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useRef, useState } from "react";
import { isImeEnter } from "@/lib/ime";
import { responseError } from "@/lib/response-error";

export default function AddCardForm({ deckId }: { deckId: string }) {
  const router = useRouter();
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [notes, setNotes] = useState("");
  const [reverse, setReverse] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  const composing = useRef(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    // A state update alone cannot block two submits in the same event turn.
    if (submitting.current || composing.current || !front.trim() || !back.trim()) return;
    submitting.current = true;
    setError("");
    setBusy(true);
    const res = await fetch("/api/cards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deckId, front, back, notes, reverse }),
    }).catch(() => null);
    submitting.current = false;
    setBusy(false);
    if (res?.ok) {
      setFront("");
      setBack("");
      setNotes("");
      router.replace(`/decks/${deckId}`);
      router.refresh();
    } else {
      setError(await responseError(res, "Could not add that card."));
    }
  }


  return (
    <form
      onSubmit={submit}
      onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={() => { composing.current = false; }}
      onKeyDown={(event) => {
        if (isImeEnter(event) || (event.key === "Enter" && composing.current)) {
          event.preventDefault();
        }
      }}
      className="space-y-3 card p-5"
    >
      <h3 className="eyebrow">Add card</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-sm text-muted">
          Front
          <input
            value={front}
            onChange={(e) => setFront(e.target.value)}
            placeholder="e.g. 你好"
            className="input mt-1"
          />
        </label>
        <label className="text-sm text-muted">
          Back
          <input
            value={back}
            onChange={(e) => setBack(e.target.value)}
            placeholder="e.g. hello"
            className="input mt-1"
          />
        </label>
      </div>
      <p className="text-xs text-muted">
        For a specific pronunciation, write it after the Chinese: 行 (háng).
        Write Chinese practice asks for the characters; Write Pinyin uses the supplied reading when recognized.
      </p>
      <label className="block text-sm text-muted">
        Notes <span className="font-normal">(optional)</span>
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="input mt-1"
        />
      </label>
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      <div className="flex items-center justify-between gap-3">
        <label className="check-row text-sm">
          <input
            type="checkbox"
            checked={reverse}
            onChange={(e) => setReverse(e.target.checked)}
            className="checkbox"
          />
          Create reverse card
        </label>
        <button
          type="submit"
          disabled={busy || !front.trim() || !back.trim()}
          className="btn btn-primary px-5"
        >
          {busy ? "Adding…" : "Add"}
        </button>
      </div>
    </form>
  );
}
