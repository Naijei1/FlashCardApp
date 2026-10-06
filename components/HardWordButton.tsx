"use client";
import { useState } from "react";
import type { Card } from "@/lib/types";

/** Star toggle for the Hard Words list; the label collapses to the star on narrow screens. */
export default function HardWordButton({ card, onChange }: { card: Card; onChange?: (hard: boolean) => void }) {
  const [hard, setHard] = useState(!!card.hard);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function toggle() {
    if (busy) return;
    setBusy(true); setError(false);
    try {
      const res = await fetch(`/api/cards/${encodeURIComponent(card.id)}/hard`, { method: "PATCH",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deckId: card.deckId, hard: !hard }) });
      if (!res.ok || !(await res.json()).ok) throw new Error();
      setHard(!hard);
      onChange?.(!hard);
    } catch { setError(true); } finally { setBusy(false); }
  }
  return (
    <div className="relative shrink-0">
      <button type="button" aria-pressed={hard} disabled={busy} onClick={(event) => { event.stopPropagation(); void toggle(); }}
        aria-label={hard ? "In Hard Words — remove" : "Mark as hard"}
        title={hard ? "Remove from Hard Words" : "Add to Hard Words"}
        className={`pressable inline-flex h-11 min-w-11 items-center justify-center gap-1 rounded-full border px-3 text-sm whitespace-nowrap disabled:opacity-50 ${
          hard ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300" : "border-border text-muted hover:text-foreground"
        }`}>
        <span aria-hidden="true">{hard ? "★" : "☆"}</span>
        <span className="hidden sm:inline">{hard ? " In Hard Words" : " Mark as hard"}</span>
      </button>
      {error && <p role="alert" className="absolute right-0 top-full mt-1 text-xs whitespace-nowrap text-red-500">Couldn’t save. Try again.</p>}
    </div>
  );
}
