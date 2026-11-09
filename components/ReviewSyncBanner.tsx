"use client";

import { useEffect, useRef, useState } from "react";
import { createReviewSync, type ReviewSyncState } from "./reviewSync";
import SyncNotice from "./SyncNotice";

const INITIAL: ReviewSyncState = {
  pendingCount: 0,
  failedCount: 0,
  blockedCount: 0,
  isSyncing: false,
  persistenceAvailable: true,
};

/**
 * Pending and failed saves stay visible after leaving a session. Counts come
 * from the server, so this notice is the only signal that a write has not landed.
 */
export default function ReviewSyncBanner() {
  const [state, setState] = useState<ReviewSyncState>(INITIAL);
  const syncRef = useRef<ReturnType<typeof createReviewSync> | null>(null);

  useEffect(() => {
    const sync = createReviewSync(() => {});
    syncRef.current = sync;
    const unsubscribe = sync.subscribe(setState);
    return () => {
      unsubscribe();
      sync.dispose();
      syncRef.current = null;
    };
  }, []);

  if (state.pendingCount === 0) return null;
  return (
    <div className="pt-4">
      <SyncNotice
        state={state}
        onRetry={() => {
          syncRef.current?.discardBlocked();
          syncRef.current?.retryFailed();
        }}
      />
    </div>
  );
}
