import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { badRequest, requireSession } from "@/lib/api";
import { listDecks, putDeck } from "@/lib/db";
import type { Deck } from "@/lib/types";
import { isSupportedLanguage } from "@/lib/languages";
import { isRecord, MAX_DECK_NAME_LENGTH } from "@/lib/validation";

export async function GET() {
  const auth = await requireSession();
  if (auth.response) return auth.response;
  return NextResponse.json(await listDecks(auth.session));
}

export async function POST(request: Request) {
  const auth = await requireSession();
  if (auth.response) return auth.response;
  const body: unknown = await request.json().catch(() => null);
  if (!isRecord(body)) return badRequest("invalid body");
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return badRequest("deck name is required");
  if (name.length > MAX_DECK_NAME_LENGTH) return badRequest("deck name is too long");
  const frontLanguage = body.frontLanguage ?? "";
  const backLanguage = body.backLanguage ?? "";
  if (!isSupportedLanguage(frontLanguage)) {
    return badRequest("unsupported front language");
  }
  if (!isSupportedLanguage(backLanguage)) {
    return badRequest("unsupported back language");
  }
  const now = new Date().toISOString();
  const deck: Deck = {
    id: randomUUID(),
    name,
    ...(frontLanguage ? { frontLanguage } : {}),
    ...(backLanguage ? { backLanguage } : {}),
    createdAt: now,
    updatedAt: now,
  };
  await putDeck({ ...deck, source: auth.session.isAdmin ? "global" : "private" }, {
    create: true,
    session: auth.session,
  });
  return NextResponse.json(deck, { status: 201 });
}
