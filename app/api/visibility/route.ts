import { NextResponse } from "next/server";
import { badRequest, notFound, requireRegularUser } from "@/lib/api";
import { authMode } from "@/lib/auth";
import {
  getCard,
  getDeck,
  hideGlobalCard,
  hideGlobalDeck,
  unhideGlobalCard,
  unhideGlobalDeck,
} from "@/lib/db";

/** Hide or unhide a global deck or card for the signed-in regular user. */
export async function POST(request: Request) {
  if (authMode() === "shared") return NextResponse.json({ error: "not found" }, { status: 404 });
  const auth = await requireRegularUser();
  if (auth.response) return auth.response;
  const body: unknown = await request.json().catch(() => null);
  const record = body && typeof body === "object" ? body as Record<string, unknown> : null;
  const deckId = typeof record?.deckId === "string" ? record.deckId : "";
  const cardId = typeof record?.cardId === "string" ? record.cardId : "";
  if (!deckId || typeof record?.hidden !== "boolean") {
    return badRequest("deckId and hidden are required");
  }
  const deck = await getDeck(deckId, auth.session, { includeHidden: true });
  if (!deck || deck.source !== "global") return notFound("global deck not found");
  if (cardId) {
    const card = await getCard(deckId, cardId, auth.session, { includeHidden: true });
    if (!card || card.source !== "global") return notFound("global card not found");
    if (record.hidden) await hideGlobalCard(deckId, cardId, auth.session);
    else await unhideGlobalCard(deckId, cardId, auth.session);
  } else if (record.hidden) {
    await hideGlobalDeck(deckId, auth.session);
  } else {
    await unhideGlobalDeck(deckId, auth.session);
  }
  return NextResponse.json({ ok: true, hidden: record.hidden });
}
