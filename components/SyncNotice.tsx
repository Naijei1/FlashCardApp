"use client";

import { plural } from "@/lib/plural";
import type { ReviewSyncState } from "./reviewSync";

/** Pending/failed background saves, with a recovery action when saving is stuck. */
export default function SyncNotice({
  state,
  onRetry,
  compact = false,
}: {
  state: ReviewSyncState;
  onRetry: () => void;
  compact?: boolean;
}) {
  if (state.pendingCount === 0) return null;
  const failed = state.failedCount > 0;
  return (
    <div className={`flex flex-col items-center gap-2 ${compact ? "mb-2 text-xs" : "text-sm"}`}>
      <p
        role={failed ? "alert" : undefined}
        className={`rounded-lg px-3 py-2 text-center ${failed ? "bg-red-500/10 text-red-600 dark:text-red-400" : "text-muted"}`}
      >
        {state.blockedCount > 0
          ? `${plural(state.blockedCount, "review")} cannot be saved because the card changed or was removed. Discard to continue.`
          : failed
            ? `${plural(state.failedCount, "review")} still need to be saved.`
            : `Saving ${plural(state.pendingCount, "review")}…`}
      </p>
      {failed && (
        <button type="button" onClick={onRetry} className="btn btn-danger">
          {state.blockedCount > 0 ? "Discard unsavable and continue" : "Retry saving"}
        </button>
      )}
      {!state.persistenceAvailable && (
        <p role="alert" className="max-w-sm text-center text-amber-600 dark:text-amber-400">
          This browser could not store pending reviews. Keep this page open until saving finishes.
        </p>
      )}
    </div>
  );
}
