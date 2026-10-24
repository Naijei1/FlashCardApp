"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { responseError } from "@/lib/response-error";

type HiddenCard = { id: string; deckId: string; front: string; back: string };

export default function HiddenCards({ deckId }: { deckId: string }) {
  const router = useRouter();
  const [cards, setCards] = useState<HiddenCard[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/visibility?deckId=${encodeURIComponent(deckId)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response, "Could not load hidden cards."));
        return response.json() as Promise<{ cards?: HiddenCard[] }>;
      })
      .then((body) => {
        if (!cancelled) {
          setCards(body.cards ?? []);
          setLoaded(true);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setLoaded(true);
          setError(cause instanceof Error ? cause.message : "Could not load hidden cards.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [deckId]);

  if (!loaded && !error) return null;
  if (error && cards.length === 0) {
    return <p role="alert" className="text-sm text-red-500">{error}</p>;
  }
  if (cards.length === 0) return null;

  async function unhide(cardId: string) {
    setError("");
    const response = await fetch("/api/visibility", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deckId, cardId, hidden: false }),
    }).catch(() => null);
    if (response?.ok) {
      setCards((current) => current.filter((card) => card.id !== cardId));
      router.refresh();
    } else {
      setError(await responseError(response, "Could not unhide this card."));
    }
  }

  return (
    <section className="space-y-2">
      <h2 className="eyebrow">Hidden from your study</h2>
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      <ul className="space-y-2">
        {cards.map((card) => (
          <li key={card.id} className="card flex items-center gap-3 px-4 py-3 text-sm">
            <span className="min-w-0 flex-1 truncate" title={`${card.front} → ${card.back}`}>{card.front} → {card.back}</span>
            <button type="button" onClick={() => unhide(card.id)} className="btn btn-secondary">Unhide</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
