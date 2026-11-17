import { NextResponse } from "next/server";
import { accessErrorResponse, badRequest, requireRegularUser } from "@/lib/api";
import { listDecks } from "@/lib/db";
import { createPracticeGroup, listPracticeGroups } from "@/lib/practice-group-store";
import { parseGroupInput, type GroupInput } from "@/lib/practice-groups";

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET() {
  const denied = await requireRegularUser();
  if (denied) return denied;
  try {
    return NextResponse.json({ groups: await listPracticeGroups() }, { headers: NO_STORE });
  } catch (error) {
    const access = accessErrorResponse(error);
    if (access) return access;
    throw error;
  }
}

export async function POST(request: Request) {
  const denied = await requireRegularUser();
  if (denied) return denied;
  const body: unknown = await request.json().catch(() => null);
  try {
    // Only lessons this learner can see right now may be saved.
    const allowed = new Set((await listDecks()).map((deck) => deck.id));
    const parsed = parseGroupInput(body, allowed);
    if (!parsed.ok) return badRequest(parsed.error);
    const group = await createPracticeGroup(parsed.value as GroupInput);
    return NextResponse.json(group, { status: 201, headers: NO_STORE });
  } catch (error) {
    const access = accessErrorResponse(error);
    if (access) return access;
    throw error;
  }
}
