import { NextResponse } from "next/server";
import { accessErrorResponse, requireAdmin } from "@/lib/api";
import { usesMultiUserData } from "@/lib/flags";

type Context = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Context) {
  const denied = await requireAdmin();
  if (denied) return denied;
  if (!usesMultiUserData()) {
    return NextResponse.json(
      { error: "Set DATA_MODE=multi-user after migration before publishing" },
      { status: 409 }
    );
  }
  const { id } = await params;
  try {
    const { publishDeckNow } = await import("@/lib/multi-user-store");
    return NextResponse.json(await publishDeckNow(id));
  } catch (error) {
    const access = accessErrorResponse(error);
    if (access) return access;
    throw error;
  }
}
