import { NextResponse } from "next/server";
import { accessErrorResponse, badRequest, notFound, requireRegularUser } from "@/lib/api";
import { loadCramSet } from "@/lib/cram-set";
import { appTimeZone } from "@/lib/forecast";
import { buildGroupQueue, type GroupPlan } from "@/lib/group-study";
import type { ReviewMode } from "@/lib/types";

const MODES: ReviewMode[] = ["review", "write", "pinyin"];
const PLANS: GroupPlan[] = ["today", "all"];
const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" };

/**
 * A study batch for a saved group. Cards come from the learner's release-gated
 * reads; ratings are saved by the client through /api/review like any session.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireRegularUser();
  if (denied) return denied;
  const { id } = await params;
  const searchParams = new URL(request.url).searchParams;
  const mode = (searchParams.get("mode") || "review") as ReviewMode;
  const plan = (searchParams.get("plan") || "today") as GroupPlan;
  if (!MODES.includes(mode)) return badRequest("unsupported mode");
  if (!PLANS.includes(plan)) return badRequest("unsupported plan");
  try {
    const set = await loadCramSet(id, undefined, { consistent: true });
    if (!set) return notFound("group not found");
    const data = buildGroupQueue(set.entries, {
      group: set.group,
      decks: set.decks,
      now: new Date(),
      timeZone: appTimeZone(),
      mode,
      plan,
      extendNew: searchParams.get("new") === "1",
    });
    return NextResponse.json(data, { headers: NO_STORE });
  } catch (error) {
    const access = accessErrorResponse(error);
    if (access) return access;
    throw error;
  }
}
