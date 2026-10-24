import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-xl font-semibold">That page was not found</h1>
      <p className="max-w-sm text-sm text-muted">The link may be old, or you may need to sign in first.</p>
      <div className="flex flex-wrap justify-center gap-2">
        <Link href="/" className="btn btn-primary">Home</Link>
        <Link href="/login" className="btn btn-secondary">Log in</Link>
      </div>
    </main>
  );
}
