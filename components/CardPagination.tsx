import Link from "next/link";

type CardPaginationProps = {
  basePath: string;
  currentPage: number;
  totalPages: number;
  query?: Record<string, string | undefined>;
};

function pageHref(
  basePath: string,
  page: number,
  query: Record<string, string | undefined>
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value) params.set(key, value);
  }
  if (page > 1) params.set("page", String(page));
  const suffix = params.toString();
  return suffix ? `${basePath}?${suffix}` : basePath;
}

export default function CardPagination({
  basePath,
  currentPage,
  totalPages,
  query = {},
}: CardPaginationProps) {
  if (totalPages <= 1) return null;

  const linkClass =
    "pressable rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium";
  const disabledClass =
    "rounded-lg border border-border px-4 py-2 text-sm text-muted opacity-50";

  return (
    <nav aria-label="Card pages" className="flex items-center justify-between gap-3 pt-2">
      {currentPage > 1 ? (
        <Link
          href={pageHref(basePath, currentPage - 1, query)}
          rel="prev"
          prefetch={false}
          className={linkClass}
        >
          ← Previous
        </Link>
      ) : (
        <span aria-disabled="true" className={disabledClass}>
          ← Previous
        </span>
      )}

      <span className="text-sm tabular-nums text-muted">
        Page {currentPage} of {totalPages}
      </span>

      {currentPage < totalPages ? (
        <Link
          href={pageHref(basePath, currentPage + 1, query)}
          rel="next"
          prefetch={false}
          className={linkClass}
        >
          Next →
        </Link>
      ) : (
        <span aria-disabled="true" className={disabledClass}>
          Next →
        </span>
      )}
    </nav>
  );
}
