import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api";

/** Per-card progress is never returned to the admin account. */
export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  return NextResponse.json(
    { error: "per-card progress is not available to admin accounts" },
    { status: 403, headers: { "Cache-Control": "private, no-store" } }
  );
}
