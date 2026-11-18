import { NextResponse } from "next/server";
import { accessErrorResponse, badRequest, notFound, requireRegularUser } from "@/lib/api";
import { listDecks } from "@/lib/db";
import { deletePracticeGroup, getPracticeGroup, updatePracticeGroup } from "@/lib/practice-group-store";
import { parseGroupInput } from "@/lib/practice-groups";

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" };

type Params = { params: Promise<{ id: string }> };

function handled(error: unknown) {
  const access = accessErrorResponse(error);
  if (access) return access;
  throw error;
}

export async function GET(_request: Request, { params }: Params) {
  const denied = await requireRegularUser();
  if (denied) return denied;
  const { id } = await params;
  try {
    const group = await getPracticeGroup(id);
    if (!group) return notFound("group not found");
    return NextResponse.json(group, { headers: NO_STORE });
  } catch (error) {
    return handled(error);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  const denied = await requireRegularUser();
  if (denied) return denied;
  const { id } = await params;
  const body: unknown = await request.json().catch(() => null);
  try {
    const visible = new Set((await listDecks()).map((deck) => deck.id));
    // A lesson saved earlier may have been hidden since. Keeping it in the
    // selection is harmless (reads skip it); adding a new invisible one is not.
    const current = await getPracticeGroup(id);
    if (!current) return notFound("group not found");
    const allowed = new Set([...visible, ...current.deckIds]);
    const parsed = parseGroupInput(body, allowed, { partial: true });
    if (!parsed.ok) return badRequest(parsed.error);
    if (Object.values(parsed.value).every((value) => value === undefined)) return badRequest("nothing to update");
    return NextResponse.json(await updatePracticeGroup(id, parsed.value), { headers: NO_STORE });
  } catch (error) {
    return handled(error);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  const denied = await requireRegularUser();
  if (denied) return denied;
  const { id } = await params;
  try {
    await deletePracticeGroup(id);
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    return handled(error);
  }
}
