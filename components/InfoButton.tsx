"use client";

import { useId, useRef, useState, type PointerEvent, type ReactNode } from "react";

function onBackdrop(event: PointerEvent<HTMLDialogElement>) {
  const { left, right, top, bottom } = event.currentTarget.getBoundingClientRect();
  return event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom;
}

export default function InfoButton({ topic, children, descriptionId }: {
  topic: string;
  children: ReactNode;
  descriptionId?: string;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const pressedBackdrop = useRef(false);
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className="btn btn-ghost size-11 shrink-0 !p-0"
        aria-label={`About ${topic}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={id}
        onClick={(event) => {
          event.currentTarget.focus();
          dialog.current?.showModal();
          close.current?.focus();
          setOpen(true);
        }}>
        <span aria-hidden="true" className="grid size-5 place-items-center rounded-full border border-current text-xs font-semibold leading-none">i</span>
      </button>
      <dialog ref={dialog} id={id} aria-labelledby={`${id}-title`} closedby="any"
        className="info-dialog card text-left text-foreground"
        onClose={() => setOpen(dialog.current?.open ?? false)}
        onPointerDown={(event) => { pressedBackdrop.current = onBackdrop(event); }}
        onPointerUp={(event) => {
          if (!("closedBy" in event.currentTarget) && pressedBackdrop.current && onBackdrop(event)) dialog.current?.close();
          pressedBackdrop.current = false;
        }}>
        <div className="flex items-center justify-between gap-3">
          <h2 id={`${id}-title`} className="text-base font-semibold normal-case tracking-normal">{topic}</h2>
          <button ref={close} type="button" className="btn btn-secondary" onClick={() => dialog.current?.close()}>Close</button>
        </div>
        <div id={descriptionId} className="mt-3 space-y-2 text-sm leading-relaxed text-muted">{children}</div>
      </dialog>
    </>
  );
}
