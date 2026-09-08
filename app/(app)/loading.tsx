export default function AppLoading() {
  return (
    <div className="space-y-4 py-6" role="status" aria-label="Loading">
      <div className="h-8 w-48 animate-pulse rounded bg-border/60" />
      <div className="h-36 animate-pulse rounded-2xl border border-border bg-surface" />
      <div className="h-20 animate-pulse rounded-2xl border border-border bg-surface" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
