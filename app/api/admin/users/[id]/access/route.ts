import { NextResponse } from "next/server";
import { accessErrorResponse, badRequest, requireAdmin } from "@/lib/api";
import { usesMultiUserData } from "@/lib/flags";
import { isRecord } from "@/lib/validation";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  const denied = await requireAdmin();
  if (denied) return denied;
  if (!usesMultiUserData()) {
    return NextResponse.json(
      { error: "Set DATA_MODE=multi-user after migration before changing learner access" },
      { status: 409 }
    );
  }
  const body: unknown = await request.json().catch(() => null);
  if (!isRecord(body) || typeof body.disabled !== "boolean") return badRequest("disabled must be true or false");
  const { id } = await params;
  try {
    const { setLearnerDisabled } = await import("@/lib/multi-user-store");
    await setLearnerDisabled(id, body.disabled);
    return NextResponse.json({ userId: id, disabled: body.disabled });
  } catch (error) {
    const access = accessErrorResponse(error);
    if (access) return access;
    throw error;
  }
}
