import { NextResponse } from "next/server";
import { badRequest, notFound, requireAuth } from "@/lib/api";
import { deleteDeck, getDeck, putDeck } from "@/lib/db";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  const denied = await requireAuth();
  if (denied) return denied;
  const { id } = await params;
  const deck = await getDeck(id);
  if (!deck) return notFound("deck not found");
  const body = await request.json().catch(() => null);
  if (!body) return badRequest("invalid body");

  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name) return badRequest("deck name cannot be empty");
    deck.name = name;
  }
  // Empty string clears a language; undefined leaves it unchanged.
  if ("frontLanguage" in body) deck.frontLanguage = body.frontLanguage || undefined;
  if ("backLanguage" in body) deck.backLanguage = body.backLanguage || undefined;
  deck.updatedAt = new Date().toISOString();
  await putDeck(deck);
  return NextResponse.json(deck);
}

export async function DELETE(_request: Request, { params }: Context) {
  const denied = await requireAuth();
  if (denied) return denied;
  const { id } = await params;
  await deleteDeck(id);
  return NextResponse.json({ ok: true });
}
