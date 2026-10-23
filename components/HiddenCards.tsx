"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type HiddenCard = { id: string; deckId: string; front: string; back: string };

export default function HiddenCards({ deckId }: { deckId: string }) {
  const router = useRouter();
  const [cards, setCards] = useState<HiddenCard[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/visibility?deckId=${encodeURIComponent(deckId)}`)
      .then((response) => (response.ok ? response.json() : { cards: [] }))
      .then((body) => {
        if (!cancelled) setCards(body.cards ?? []);
      })
      .catch(() => {
        if (!cancelled) setCards([]);
      });
    return () => {
      cancelled = true;
    };
  }, [deckId]);

  if (cards.length === 0) return null;

  async function unhide(cardId: string) {
    const response = await fetch("/api/visibility", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deckId, cardId, hidden: false }),
    });
    if (response.ok) {
      setCards((current) => current.filter((card) => card.id !== cardId));
      router.refresh();
    }
  }

  return (
    <section className="space-y-2">
      <h2 className="eyebrow">Hidden from your study</h2>
      <ul className="space-y-2">
        {cards.map((card) => (
          <li key={card.id} className="card flex items-center gap-3 px-4 py-3 text-sm">
            <span className="min-w-0 flex-1 truncate">{card.front} → {card.back}</span>
            <button type="button" onClick={() => unhide(card.id)} className="btn btn-secondary">Unhide</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
