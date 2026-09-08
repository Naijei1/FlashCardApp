import { notFound, requireAuth } from "@/lib/api";
import { spreadsheetSafeField, toCsv } from "@/lib/csv";
import { getDeck, listCards } from "@/lib/db";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const denied = await requireAuth();
  if (denied) return denied;
  const { id } = await params;
  const deck = await getDeck(id);
  if (!deck) return notFound("deck not found");
  const cards = await listCards(id);
  const csv = toCsv([
    ["front", "back", "notes"],
    ...cards.map((c) =>
      [c.front, c.back, c.notes ?? ""].map(spreadsheetSafeField)
    ),
  ]);
  const filename = `${deck.name.replace(/[^\p{L}\p{N}_-]+/gu, "_")}.csv`;
  // BOM helps Excel detect UTF-8 for Chinese text.
  return new Response("\uFEFF" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
