import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-3 py-8 text-center">
      <h1 className="text-xl font-semibold">That page was not found</h1>
      <Link href="/" className="btn btn-primary">
        Back home
      </Link>
    </div>
  );
}
