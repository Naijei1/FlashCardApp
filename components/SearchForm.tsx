"use client";

import { preventImeSubmit } from "@/lib/ime";
import { IconSearch } from "./icons";

export default function SearchForm({ defaultValue }: { defaultValue: string }) {
  return (
    <form role="search" method="GET" action="/browse" className="relative" onKeyDown={preventImeSubmit}>
      <label htmlFor="card-search" className="sr-only">
        Search cards
      </label>
      <IconSearch className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted" />
      <input
        id="card-search"
        type="search"
        name="q"
        defaultValue={defaultValue}
        aria-describedby="search-summary"
        placeholder="Search front, back, or notes…"
        enterKeyHint="search"
        autoCorrect="off"
        className="input py-3 pl-10"
      />
    </form>
  );
}
