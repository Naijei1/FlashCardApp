"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { plural } from "@/lib/plural";
import type { LookupWord } from "@/lib/characters";
import { IconChevronRight, IconX } from "./icons";

export type LookupRequest = {
  character: string;
  deckId: string;
  cardId: string;
  anchor: DOMRect;
  element: HTMLElement | null;
};

type LookupApi = {
  open: (request: LookupRequest) => void;
  active: LookupRequest | null;
};

const LookupContext = createContext<LookupApi | null>(null);

export function useCharacterLookup(): LookupApi | null {
  return useContext(LookupContext);
}

type LookupPayload = {
  words: LookupWord[];
  total: number;
  truncated: boolean;
};

export function CharacterLookupProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<LookupRequest | null>(null);
  return (
    <LookupContext.Provider value={{ open: setRequest, active: request }}>
      {children}
      {request && <CharacterLookupDialog request={request} onClose={() => setRequest(null)} />}
    </LookupContext.Provider>
  );
}

function useWideViewport(): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(min-width: 768px)");
    const apply = () => setWide(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);
  return wide;
}

function anchorRect(request: LookupRequest): DOMRect {
  if (request.element?.isConnected) return request.element.getBoundingClientRect();
  return request.anchor;
}

export function CharacterLookupDialog({
  request,
  onClose,
}: {
  request: LookupRequest;
  onClose: () => void;
}) {
  const wide = useWideViewport();
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [payload, setPayload] = useState<LookupPayload | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    closeRef.current?.focus();
  }, [request.character, request.cardId, request.deckId]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      c: request.character,
      deckId: request.deckId,
      cardId: request.cardId,
    });
    fetch(`/api/characters?${params}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("lookup failed");
        return response.json() as Promise<LookupPayload>;
      })
      .then((data) => {
        setPayload({
          words: Array.isArray(data.words) ? data.words : [],
          total: typeof data.total === "number" ? data.total : 0,
          truncated: data.truncated === true,
        });
        setError(false);
      })
      .catch((fetchError: unknown) => {
        if (fetchError instanceof Error && fetchError.name === "AbortError") return;
        setError(true);
        setPayload(null);
      });
    return () => controller.abort();
  }, [attempt, request.cardId, request.character, request.deckId]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      const blocked = event.key === " " || event.key === "Enter" || ["1", "2", "3", "4", "ArrowLeft", "ArrowRight"].includes(event.key);
      if (!blocked) return;
      const target = event.target;
      const interactive = target instanceof Element && !!target.closest("a[href], button, input, textarea, select");
      if (interactive && (event.key === " " || event.key === "Enter")) return;
      event.preventDefault();
      event.stopPropagation();
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  useEffect(() => {
    if (!wide) return;
    const update = () => setFrame((value) => value + 1);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [wide]);

  const words = payload?.words ?? [];
  const total = payload?.total ?? words.length;
  const countLabel = payload?.truncated
    ? `Showing ${words.length} of ${plural(total, "word")} in your decks`
    : `${plural(total, "word")} in your decks`;
  const body = (
    <div ref={dialogRef} className="flex min-h-0 flex-col">
      {wide ? (
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <h2 id={titleId} className="min-w-0 flex-1 truncate text-base font-semibold">
            <span className="hanzi-text text-accent">{request.character}</span>
            <span> · also in</span>
          </h2>
          <button ref={closeRef} type="button" className="pressable flex h-11 w-11 items-center justify-center rounded-full text-muted hover:bg-surface-muted hover:text-foreground" aria-label="Close" onClick={onClose}>
            <IconX strokeWidth={1.8} />
          </button>
        </div>
      ) : (
        <div className="px-4 pt-1 pb-2">
          <div className="mx-auto mt-2 mb-3 h-1.5 w-10 rounded-full bg-foreground/20" aria-hidden="true" />
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-lg font-semibold tracking-tight">
                <span className="hanzi-text text-accent">{request.character}</span>
                <span> · appears in</span>
              </h2>
              <p className="text-sm text-muted">{error ? "Lookup failed" : payload ? countLabel : "Looking up…"}</p>
            </div>
            <button ref={closeRef} type="button" className="pressable flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-muted hover:text-foreground" aria-label="Close" onClick={onClose}>
              <IconX strokeWidth={1.8} />
            </button>
          </div>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {error && (
          <div className="px-4 py-6 text-center">
            <p className="text-sm text-muted">Could not look up this character.</p>
            <button type="button" className="btn btn-secondary mt-3" onClick={() => setAttempt((value) => value + 1)}>
              Try again
            </button>
          </div>
        )}
        {!error && !payload && <p className="px-4 py-6 text-sm text-muted">Looking up…</p>}
        {!error && payload && words.length === 0 && (
          <p className="px-4 py-6 text-sm text-muted">No other words with this character yet.</p>
        )}
        {!error && payload && words.length > 0 && (
          <ul>
            {words.map((word) => (
              <li key={`${word.deckId}:${word.cardId}`} className="border-t border-border/80">
                <Link
                  href={`/browse?q=${encodeURIComponent(word.hanzi)}`}
                  className="flex min-h-11 items-center gap-3 px-4 py-2.5 hover:bg-surface-muted"
                >
                  {wide && <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
                  <span className="min-w-0 flex-1">
                    {wide ? (
                      <span className="block truncate">
                        <span className="hanzi-text text-base font-medium">{word.hanzi}</span>
                        <span className="text-muted"> — {word.meaning}</span>
                      </span>
                    ) : (
                      <>
                        <span className="hanzi-text block text-lg font-medium">{word.hanzi}</span>
                        {word.pinyin && <span className="block text-sm text-muted">{word.pinyin}</span>}
                        <span className="block text-sm text-muted">{word.meaning}</span>
                      </>
                    )}
                  </span>
                  <IconChevronRight className="shrink-0 text-muted" strokeWidth={1.8} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );

  const rect = anchorRect(request);
  void frame;
  let popoverStyle: CSSProperties | undefined;
  let arrowLeft = 24;
  let placeBelow = true;
  if (wide && typeof window !== "undefined") {
    const width = Math.min(320, window.innerWidth - 16);
    let left = rect.left + rect.width / 2 - width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    const spaceBelow = window.innerHeight - rect.bottom;
    placeBelow = spaceBelow >= 200 || spaceBelow >= rect.top;
    popoverStyle = {
      position: "fixed",
      left,
      width,
      top: placeBelow ? Math.min(rect.bottom + 12, window.innerHeight - 16) : undefined,
      bottom: placeBelow ? undefined : Math.max(8, window.innerHeight - rect.top + 12),
      maxHeight: "min(24rem, calc(100dvh - 1.5rem))",
    };
    arrowLeft = rect.left + rect.width / 2 - left;
  }

  const dialog = wide ? (
    <>
      <button type="button" className="fixed inset-0 z-40 cursor-default bg-transparent" aria-label="Close lookup" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={popoverStyle}
        className="z-50 flex flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-[0_16px_40px_-16px_rgb(0_0_0/0.55)]"
      >
        <span
          aria-hidden="true"
          className="absolute h-0 w-0"
          style={{
            left: Math.max(16, Math.min(arrowLeft, (popoverStyle?.width as number) - 16)),
            top: placeBelow ? -8 : undefined,
            bottom: placeBelow ? undefined : -8,
            borderLeft: "7px solid transparent",
            borderRight: "7px solid transparent",
            ...(placeBelow
              ? { borderBottom: "8px solid var(--surface)" }
              : { borderTop: "8px solid var(--surface)" }),
          }}
        />
        {body}
      </div>
    </>
  ) : (
    <div className="fixed inset-0 z-40">
      <button type="button" className="absolute inset-0 bg-black/55" aria-label="Close lookup" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="absolute inset-x-0 bottom-0 z-50 flex max-h-[min(70dvh,34rem)] flex-col rounded-t-3xl border border-border bg-surface pb-[env(safe-area-inset-bottom)] shadow-[0_-12px_40px_-16px_rgb(0_0_0/0.6)]"
      >
        {body}
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(dialog, document.body);
}
