import { NextResponse } from "next/server";
import { badRequest, notFound, requireAuth } from "@/lib/api";
import { buildCards } from "@/lib/cards";
import { batchPutCards, getDeck } from "@/lib/db";
import type { Card } from "@/lib/types";

type ImportRow = { front: string; back: string; notes?: string; reverse?: boolean };

export async function POST(request: Request) {
  const denied = await requireAuth();
  if (denied) return denied;
  const body = await request.json().catch(() => null);
  const deckId = typeof body?.deckId === "string" ? body.deckId : "";
  const rows: ImportRow[] = Array.isArray(body?.rows) ? body.rows : [];
  const reverseAll = body?.reverse === true;
  if (!deckId || rows.length === 0) {
    return badRequest("deckId and a non-empty rows array are required");
  }
  if (!(await getDeck(deckId))) return notFound("deck not found");

  const now = new Date();
  const cards: Card[] = [];
  for (const row of rows) {
    const front = typeof row.front === "string" ? row.front.trim() : "";
    const back = typeof row.back === "string" ? row.back.trim() : "";
    if (!front || !back) continue;
    cards.push(
      ...buildCards(
        {
          deckId,
          front,
          back,
          notes: typeof row.notes === "string" && row.notes.trim() ? row.notes.trim() : undefined,
          // A per-row reverse column overrides the import-wide toggle.
          reverse: typeof row.reverse === "boolean" ? row.reverse : reverseAll,
        },
        now
      )
    );
  }
  await batchPutCards(cards);
  return NextResponse.json({ created: cards.length }, { status: 201 });
}
