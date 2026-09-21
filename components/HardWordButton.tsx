"use client";
import { useState } from "react";
import type { Card } from "@/lib/types";
export default function HardWordButton({ card, onChange }: { card: Card; onChange?: (hard: boolean) => void }) {
  const [hard, setHard] = useState(!!card.hard);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function toggle() {
    if (busy) return;
    setBusy(true); setError(false);
    try {
      const res = await fetch(`/api/cards/${card.id}/hard`, { method: "PATCH",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deckId: card.deckId, hard: !hard }) });
      if (!res.ok || !(await res.json()).ok) throw new Error();
      setHard(!hard);
      onChange?.(!hard);
    } catch { setError(true); } finally { setBusy(false); }
  }
  return <div className="my-1 text-center">
    <button type="button" aria-pressed={hard} disabled={busy} onClick={toggle}
      className="rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50">
      {hard ? "★ In Hard Words · remove" : "☆ Mark as hard"}
    </button>
    {error && <p role="alert" className="text-sm text-red-500">Couldn’t save. Try again.</p>}
  </div>;
}
