import { NextResponse } from "next/server";
import { accessErrorResponse, badRequest, requireAdmin } from "@/lib/api";
import { usesMultiUserData } from "@/lib/flags";
import { releaseWeekLabel } from "@/lib/multi-user-model";
import { isRecord } from "@/lib/validation";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  const denied = await requireAdmin();
  if (denied) return denied;
  if (!usesMultiUserData()) {
    return NextResponse.json(
      { error: "Set DATA_MODE=multi-user after migration before scheduling a release" },
      { status: 409 }
    );
  }
  const body: unknown = await request.json().catch(() => null);
  if (!isRecord(body)) return badRequest("invalid body");
  const releaseWeek = Number(body.releaseWeek);
  const releaseAt = typeof body.releaseAt === "string" ? body.releaseAt : "";
  if (!Number.isInteger(releaseWeek) || releaseWeek < 1) return badRequest("releaseWeek must be a positive whole number");
  if (!Number.isFinite(Date.parse(releaseAt))) return badRequest("releaseAt must be a date");
  const { id } = await params;
  try {
    const { scheduleDeckRelease } = await import("@/lib/multi-user-store");
    const deck = await scheduleDeckRelease(id, releaseWeek, releaseAt, {
      confirmHide: body.confirmHide === true,
    });
    return NextResponse.json({ ...deck, releaseLabel: releaseWeekLabel(releaseWeek) });
  } catch (error) {
    const access = accessErrorResponse(error);
    if (access) return access;
    throw error;
  }
}
