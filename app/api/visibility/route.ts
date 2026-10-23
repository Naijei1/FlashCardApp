import { NextResponse } from "next/server";
import { accessErrorResponse, badRequest, requireRegularUser } from "@/lib/api";
import { usesMultiUserData } from "@/lib/flags";
import { isRecord } from "@/lib/validation";

export async function GET(request: Request) {
  const denied = await requireRegularUser();
  if (denied) return denied;
  if (!usesMultiUserData()) return NextResponse.json({ error: "not found" }, { status: 404 });
  const deckId = new URL(request.url).searchParams.get("deckId") ?? "";
  if (!deckId) return badRequest("deckId is required");
  const { listHiddenGlobalCards } = await import("@/lib/multi-user-store");
  const cards = await listHiddenGlobalCards(deckId);
  return NextResponse.json({ cards }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const denied = await requireRegularUser();
  if (denied) return denied;
  if (!usesMultiUserData()) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body: unknown = await request.json().catch(() => null);
  if (!isRecord(body) || typeof body.deckId !== "string" || typeof body.cardId !== "string" || typeof body.hidden !== "boolean") {
    return badRequest("deckId, cardId, and hidden are required");
  }
  try {
    const { setGlobalCardHidden } = await import("@/lib/multi-user-store");
    await setGlobalCardHidden(body.deckId, body.cardId, body.hidden);
  } catch (error) {
    const access = accessErrorResponse(error);
    if (access) return access;
    throw error;
  }
  return NextResponse.json({ ok: true, hidden: body.hidden });
}
