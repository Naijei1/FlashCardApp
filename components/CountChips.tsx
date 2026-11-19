import { plural } from "@/lib/plural";
import type { DeckCounts } from "@/lib/types";
import Chip from "./Chip";

export default function CountChips({ counts, showTotal = false }: { counts: DeckCounts; showTotal?: boolean }) {
  return (
    <>
      {counts.due > 0 && <Chip tone="accent">{counts.due} due</Chip>}
      {counts.newCards > 0 && <Chip>{counts.newCards} new</Chip>}
      {showTotal && <Chip>{plural(counts.total, "card")}</Chip>}
      {!showTotal && counts.due === 0 && counts.newCards === 0 && <Chip>Nothing due</Chip>}
    </>
  );
}
