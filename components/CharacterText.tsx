"use client";

import { useState } from "react";
import { isHanzi } from "@/lib/characters";
import { CharacterLookupDialog, useCharacterLookup, type LookupRequest } from "./CharacterLookup";

type Run = { text: string; start: number; hanzi: boolean; className: string };

function runs(text: string, decorate?: (char: string, index: number) => string | undefined): Run[] {
  const chars = [...text.normalize("NFC")];
  const grouped: Run[] = [];
  for (let index = 0; index < chars.length; index++) {
    const char = chars[index];
    const hanzi = isHanzi(char);
    const className = decorate?.(char, index) ?? "";
    const previous = grouped.at(-1);
    if (!hanzi && previous && !previous.hanzi && previous.className === className) {
      previous.text += char;
      continue;
    }
    grouped.push({ text: char, start: index, hanzi, className });
  }
  return grouped;
}

/** Renders card text, with each Chinese character tappable on its own. */
export default function CharacterText({
  text,
  className,
  lang,
  deckId,
  cardId,
  decorate,
}: {
  text: string;
  className?: string;
  lang?: string;
  deckId: string;
  cardId: string;
  decorate?: (char: string, index: number) => string | undefined;
}) {
  const lookup = useCharacterLookup();
  const [local, setLocal] = useState<LookupRequest | null>(null);
  const active = lookup?.active ?? local;
  return (
    <>
      <span lang={lang} className={className}>
        {runs(text, decorate).map((run) => {
          if (!run.hanzi) {
            return (
              <span key={run.start} className={run.className}>
                {run.text}
              </span>
            );
          }
          const pressed =
            active?.character === run.text && active.deckId === deckId && active.cardId === cardId;
          return (
            <button
              key={run.start}
              type="button"
              className={`char-hit${run.className ? ` ${run.className}` : ""}${pressed ? " char-hit-active" : ""}`}
              aria-label={`Look up ${run.text}`}
              aria-haspopup="dialog"
              aria-expanded={pressed}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                event.preventDefault();
                const request: LookupRequest = {
                  character: run.text,
                  deckId,
                  cardId,
                  anchor: event.currentTarget.getBoundingClientRect(),
                  element: event.currentTarget,
                };
                if (lookup) lookup.open(request);
                else setLocal(request);
              }}
            >
              {run.text}
            </button>
          );
        })}
      </span>
      {!lookup && local && <CharacterLookupDialog request={local} onClose={() => setLocal(null)} />}
    </>
  );
}
