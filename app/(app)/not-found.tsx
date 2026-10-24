import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-3 py-8 text-center">
      <h1 className="text-xl font-semibold">That page was not found</h1>
      <div className="flex flex-wrap justify-center gap-2">
        <Link href="/" className="btn btn-primary">Home</Link>
        <Link href="/login" className="btn btn-secondary">Log in</Link>
      </div>
    </div>
  );
}
