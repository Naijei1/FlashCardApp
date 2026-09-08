"use client";

import { useEffect } from "react";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-3 py-8 text-center">
      <h1 className="text-xl font-semibold">Could not load this page</h1>
      <p className="max-w-sm text-sm text-muted">
        Check your connection and try again. Your saved cards have not been changed.
      </p>
      <button
        type="button"
        onClick={reset}
        className="rounded-xl bg-accent px-5 py-3 font-medium text-accent-foreground"
      >
        Try again
      </button>
    </div>
  );
}
