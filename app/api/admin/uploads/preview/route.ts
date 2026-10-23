import { NextResponse } from "next/server";
import { badRequest, requireAdmin } from "@/lib/api";
import { parseCardCsv } from "@/lib/csv";
import { usesMultiUserData } from "@/lib/flags";
import { isRecord } from "@/lib/validation";

const MAX_IMPORT_BYTES = 8 * 1024 * 1024;

export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  if (!usesMultiUserData()) {
    return NextResponse.json(
      { error: "Set DATA_MODE=multi-user after migration before uploading a week" },
      { status: 409 }
    );
  }
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_IMPORT_BYTES) {
    return NextResponse.json({ error: "import payload is too large" }, { status: 413 });
  }
  const body: unknown = await request.json().catch(() => null);
  if (!isRecord(body) || typeof body.csv !== "string" || !body.csv.trim()) {
    return badRequest("csv text is required");
  }
  if (body.csv.length > MAX_IMPORT_BYTES) {
    return NextResponse.json({ error: "import payload is too large" }, { status: 413 });
  }
  try {
    const parsed = parseCardCsv(body.csv);
    return NextResponse.json({
      hasHeader: parsed.hasHeader,
      rows: parsed.rows,
      invalid: parsed.invalid,
      flippedDuplicates: parsed.flippedDuplicates,
    });
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "could not read that CSV");
  }
}
