import { accessErrorResponse, badRequest, notFound, requireRegularUser } from "@/lib/api";
import { ratingCount, type Counts, type PracticeSession } from "@/lib/lesson-stats";
import { getPracticeGroup, savePracticeSession } from "@/lib/practice-group-store";
import { isValidGroupId } from "@/lib/practice-groups";
import { isRecord } from "@/lib/validation";

function parseSession(input: unknown, deckIds: string[]): PracticeSession | null {
  if (!isRecord(input)) return null;
  const { id, startedAt, mode, lessons } = input;
  if (typeof id !== "string" || !isValidGroupId(id) || typeof startedAt !== "string" ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(startedAt) || !Number.isFinite(Date.parse(startedAt)) ||
      Date.parse(startedAt) > Date.now() + 300_000 || (mode !== "review" && mode !== "write" && mode !== "pinyin") ||
      !isRecord(lessons) || !Object.keys(lessons).length) return null;
  const rows: [string, Counts][] = [];
  for (const [deckId, counts] of Object.entries(lessons)) {
    if (!deckIds.includes(deckId)) continue;
    if (!Array.isArray(counts) || counts.length !== 4 ||
        !counts.every((n) => Number.isSafeInteger(n) && n >= 0 && n <= 1_000_000)) return null;
    const grades = counts as Counts;
    if (!ratingCount(grades)) return null;
    rows.push([deckId, grades]);
  }
  return { id, startedAt, mode, lessons: Object.fromEntries(rows) };
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireRegularUser();
  if (denied) return denied;
  const { id } = await params;
  try {
    const group = await getPracticeGroup(id);
    if (!group) return notFound("group not found");
    const session = parseSession(await request.json().catch(() => null), group.deckIds);
    if (!session) return badRequest("invalid practice session");
    if (Object.keys(session.lessons).length) await savePracticeSession(id, session);
    return new Response(null, { status: 204 });
  } catch (error) {
    const response = accessErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
