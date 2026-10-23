import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api";
import { usesMultiUserData } from "@/lib/flags";
import { adminSummaryKeys, toAdminUserSummary } from "@/lib/multi-user-model";

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  if (!usesMultiUserData()) {
    return NextResponse.json(
      { error: "Set DATA_MODE=multi-user after migration before reading learner stats" },
      { status: 409 }
    );
  }
  const { listAdminUserSummaries } = await import("@/lib/multi-user-store");
  const users = (await listAdminUserSummaries()).map((user) => {
    const sanitized = toAdminUserSummary(user);
    const allowed = new Set<string>(adminSummaryKeys());
    for (const key of Object.keys(sanitized)) {
      if (!allowed.has(key)) delete sanitized[key as keyof typeof sanitized];
    }
    return sanitized;
  });
  return NextResponse.json(
    { users },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
