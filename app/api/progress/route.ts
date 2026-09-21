import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api";
import { listAllCards } from "@/lib/db";
import { weeklyProgress } from "@/lib/practice";
import { appTimeZone } from "@/lib/forecast";

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;
  const cards = await listAllCards(undefined, { consistent: true });
  return NextResponse.json(weeklyProgress(cards, new Date(), appTimeZone()), {
    headers: { "Cache-Control": "private, no-store" },
  });
}
