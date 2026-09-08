import { NextResponse } from "next/server";
import { badRequest, notFound, requireAuth } from "@/lib/api";
import { deleteDeck, getDeck, putDeck } from "@/lib/db";
import { isSupportedLanguage } from "@/lib/languages";
import { isRecord, MAX_DECK_NAME_LENGTH } from "@/lib/validation";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  const denied = await requireAuth();
  if (denied) return denied;
  const { id } = await params;
  const deck = await getDeck(id);
  if (!deck) return notFound("deck not found");
  const body: unknown = await request.json().catch(() => null);
  if (!isRecord(body)) return badRequest("invalid body");

  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name) return badRequest("deck name cannot be empty");
    if (name.length > MAX_DECK_NAME_LENGTH) return badRequest("deck name is too long");
    deck.name = name;
  }
  // Empty string clears a language; undefined leaves it unchanged.
  if ("frontLanguage" in body) {
    if (!isSupportedLanguage(body.frontLanguage)) return badRequest("unsupported front language");
    deck.frontLanguage = body.frontLanguage || undefined;
  }
  if ("backLanguage" in body) {
    if (!isSupportedLanguage(body.backLanguage)) return badRequest("unsupported back language");
    deck.backLanguage = body.backLanguage || undefined;
  }
  if ("chineseSide" in body) {
    if (
      body.chineseSide !== "" &&
      body.chineseSide !== null &&
      body.chineseSide !== "front" &&
      body.chineseSide !== "back"
    ) {
      return badRequest("chineseSide must be front, back, or empty");
    }
    deck.chineseSide = body.chineseSide || undefined;
  }
  deck.updatedAt = new Date().toISOString();
  try {
    await putDeck(deck);
  } catch (error) {
    if (error instanceof Error && error.name === "ConditionalCheckFailedException") {
      return NextResponse.json(
        { error: "This deck changed or is being deleted. Refresh and try again." },
        { status: 409 }
      );
    }
    throw error;
  }
  return NextResponse.json(deck);
}

export async function DELETE(_request: Request, { params }: Context) {
  const denied = await requireAuth();
  if (denied) return denied;
  const { id } = await params;
  await deleteDeck(id);
  return NextResponse.json({ ok: true });
}
