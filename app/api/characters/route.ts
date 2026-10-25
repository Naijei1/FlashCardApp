import { NextResponse } from "next/server";
import { accessErrorResponse, badRequest, requireAuth } from "@/lib/api";
import { lookupCharacter } from "@/lib/character-lookup";
import { isHanzi } from "@/lib/characters";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = await requireAuth();
  if (denied) return denied;
  const url = new URL(request.url);
  const character = (url.searchParams.get("c") ?? "").normalize("NFC");
  if (!isHanzi(character)) return badRequest("one Chinese character is required");
  const deckId = url.searchParams.get("deckId") ?? "";
  const cardId = url.searchParams.get("cardId") ?? "";
  try {
    const result = await lookupCharacter(
      character,
      deckId && cardId ? { deckId, cardId } : undefined
    );
    return NextResponse.json(result);
  } catch (error) {
    const access = accessErrorResponse(error);
    if (access) return access;
    throw error;
  }
}
