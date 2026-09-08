"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Deck } from "@/lib/types";
import { responseError } from "@/lib/response-error";

/** Asked once per deck when Write mode can't tell which side is Chinese. */
export default function ChineseSideChooser({
  deck,
  backHref,
}: {
  deck: Deck;
  backHref: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function choose(side: "front" | "back") {
    setError("");
    setBusy(true);
    const res = await fetch(`/api/decks/${deck.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chineseSide: side }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) router.refresh();
    else setError(await responseError(res, "Could not save that choice."));
  }

  return (
    <div className="mx-auto flex h-dvh w-full max-w-md flex-col items-center justify-center gap-4 px-6 pb-safe text-center">
      <h1 className="text-xl font-semibold">Which side of “{deck.name}” is Chinese?</h1>
      <p className="text-sm text-muted">
        Write mode shows the other side and asks you to type the Chinese. This is saved on
        the deck (you can also set speech languages in deck settings).
      </p>
      <div className="grid w-full grid-cols-2 gap-3">
        <button
          onClick={() => choose("front")}
          disabled={busy}
          className="pressable min-h-16 rounded-2xl border border-border bg-surface text-lg font-medium disabled:opacity-50"
        >
          Front
        </button>
        <button
          onClick={() => choose("back")}
          disabled={busy}
          className="pressable min-h-16 rounded-2xl border border-border bg-surface text-lg font-medium disabled:opacity-50"
        >
          Back
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      <Link href={backHref} className="pressable mt-2 rounded-lg px-3 py-2 text-sm text-muted">
        ← Back
      </Link>
    </div>
  );
}
