"use client";

import { useState } from "react";

import type { ReactNode } from "react";

/**
 * Words cut with „…“ where their line is too narrow, a name in a row or a head: whole in the browser's tooltip only
 * while they are cut, judged as the pointer arrives, so a name shown in full is never repeated in a tooltip over
 * it. A row whose link stretches over the whole row carries the tooltip from anywhere on the row, which is why a
 * name standing whole must carry none. `children` is what is drawn, the words themselves or the link holding them.
 */
export function CutText({ text, className, id, children }: { text: string; className: string; id?: string; children?: ReactNode }) {
  const [isCut, setCut] = useState(false);
  return (
    <span
      id={id}
      className={className}
      title={isCut ? text : undefined}
      onPointerEnter={(event) => setCut(event.currentTarget.scrollWidth > event.currentTarget.clientWidth)}>
      {children ?? text}
    </span>
  );
}
