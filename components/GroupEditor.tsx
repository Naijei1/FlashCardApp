"use client";

import { useState } from "react";
import type { LessonSection } from "@/lib/practice-groups";
import PracticeGroupForm from "./PracticeGroupForm";

/** Rename, change lessons, or delete a saved group, revealed on demand. */
export default function GroupEditor({
  sections,
  group,
}: {
  sections: LessonSection[];
  group: { id: string; name: string; deckIds: string[]; examDate?: string; targetRecall?: number };
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn btn-secondary w-full sm:w-auto">
        Edit group
      </button>
    );
  }
  return (
    <section aria-label="Edit group" className="card p-5">
      <PracticeGroupForm key={`${group.name}:${group.deckIds.join(",")}:${group.examDate ?? ""}:${group.targetRecall ?? ""}`} sections={sections} group={group}
        onDone={() => setOpen(false)} />
    </section>
  );
}
