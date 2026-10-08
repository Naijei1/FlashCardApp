import { NextResponse } from "next/server";
import { requireRegularUser } from "@/lib/api";
import { listAllCards } from "@/lib/db";
import { weeklyProgress } from "@/lib/practice";
import { appTimeZone } from "@/lib/forecast";

export async function GET() {
  const auth = await requireRegularUser();
  if (auth.response) return auth.response;
  const cards = await listAllCards(undefined, { consistent: true, session: auth.session });
  return NextResponse.json(weeklyProgress(cards, new Date(), appTimeZone()), {
    headers: { "Cache-Control": "private, no-store" },
  });
}
