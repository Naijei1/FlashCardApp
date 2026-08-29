import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { badRequest, requireAuth } from "@/lib/api";
import { listDecks, putDeck } from "@/lib/db";
import type { Deck } from "@/lib/types";

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;
  return NextResponse.json(await listDecks());
}

export async function POST(request: Request) {
  const denied = await requireAuth();
  if (denied) return denied;
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return badRequest("deck name is required");
  const now = new Date().toISOString();
  const deck: Deck = {
    id: randomUUID(),
    name,
    ...(body.frontLanguage ? { frontLanguage: String(body.frontLanguage) } : {}),
    ...(body.backLanguage ? { backLanguage: String(body.backLanguage) } : {}),
    createdAt: now,
    updatedAt: now,
  };
  await putDeck(deck);
  return NextResponse.json(deck, { status: 201 });
}
