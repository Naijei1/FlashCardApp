"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { MAX_GROUP_NAME_LENGTH, type LessonSection } from "@/lib/practice-groups";
import { plural } from "@/lib/plural";
import { responseError } from "@/lib/response-error";


/** Create or edit a saved practice group: a name and a set of lessons. */
export default function PracticeGroupForm({
  sections,
  group,
  onDone,
}: {
  sections: LessonSection[];
  group?: { id: string; name: string; deckIds: string[] };
  /** Edit mode closes in place instead of navigating. */
  onDone?: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(group?.name ?? "");
  const [selected, setSelected] = useState<Set<string>>(() => new Set(group?.deckIds ?? []));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const visibleIds = new Set(sections.flatMap((section) => section.lessons.map((lesson) => lesson.id)));
  const deckIds = [...selected].filter((id) => visibleIds.has(id));
  const count = deckIds.length;
  // In edit mode, an untouched lesson selection is not sent, so a rename keeps
  // every saved lesson, including ones that are unavailable right now. This
  // also lets a group whose lessons are all unavailable still be renamed.
  const originalIds = (group?.deckIds ?? []).filter((id) => visibleIds.has(id));
  const lessonsChanged = !group || count !== new Set(originalIds).size || deckIds.some((id) => !originalIds.includes(id));
  const canSave = !busy && name.trim() !== "" && (count > 0 || !lessonsChanged);

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    setError("");
    setBusy(true);
    // When the selection changes, lessons hidden or removed since saving drop out.
    const res = await fetch(group ? `/api/practice-groups/${encodeURIComponent(group.id)}` : "/api/practice-groups", {
      method: group ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(lessonsChanged ? { name, deckIds } : { name }),
    }).catch(() => null);
    if (!res?.ok) {
      setBusy(false);
      setError(await responseError(res, "Could not save the group."));
      return;
    }
    const saved = (await res.json()) as { id: string };
    setBusy(false);
    if (group) {
      onDone?.();
      router.refresh();
    } else {
      router.replace(`/groups/${encodeURIComponent(saved.id)}`);
    }
  }

  async function remove() {
    if (!group || !confirm(`Delete the group "${group.name}"? Your lessons and progress are not affected.`)) return;
    setError("");
    setBusy(true);
    const res = await fetch(`/api/practice-groups/${encodeURIComponent(group.id)}`, { method: "DELETE" }).catch(() => null);
    setBusy(false);
    if (res?.ok) router.replace("/");
    else setError(await responseError(res, "Could not delete the group."));
  }

  const noLessons = sections.every((section) => section.lessons.length === 0);

  return (
    <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <label className="block text-sm">
        <span className="text-muted">Group name</span>
        <input value={name} onChange={(event) => setName(event.target.value)} maxLength={MAX_GROUP_NAME_LENGTH}
          placeholder="Final: L6–10" className="input mt-1" enterKeyHint="done" />
      </label>

      {noLessons ? (
        <p className="card p-4 text-sm text-muted">No lessons are available to combine yet.</p>
      ) : sections.map((section) => section.lessons.length > 0 && (
        <fieldset key={section.title} className="space-y-2">
          <legend className="eyebrow mb-2">{section.title}</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {section.lessons.map((lesson) => {
              const checked = selected.has(lesson.id);
              return (
                <label key={lesson.id}
                  className={`pressable card flex min-h-14 cursor-pointer items-center gap-3 px-4 py-3 ${checked ? "border-accent/60 bg-accent/5" : ""}`}>
                  <input type="checkbox" checked={checked} onChange={() => toggle(lesson.id)}
                    className="checkbox" />
                  <span className="min-w-0 flex-1">
                    {lesson.kicker && <span className="block text-[11px] font-semibold tracking-wider text-accent uppercase">{lesson.kicker}</span>}
                    <span className="block truncate font-medium">{lesson.name}</span>
                    <span className="block text-xs text-muted">{plural(lesson.cards, "card")}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button type="submit" disabled={!canSave} className="btn btn-primary btn-lg flex-1">
          {group ? "Save changes" : count > 0 ? `Save group · ${plural(count, "lesson")}` : "Pick lessons"}
        </button>
        {group && (
          <>
            <button type="button" onClick={onDone} disabled={busy} className="btn btn-secondary btn-lg">Cancel</button>
            <button type="button" onClick={remove} disabled={busy} className="btn btn-danger btn-lg">Delete</button>
          </>
        )}
      </div>
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
    </form>
  );
}
