"use client";

import { createContext, use, useEffect, useRef, useState } from "react";

import type { PointerEvent, ReactNode } from "react";

/** Whether words overflow their box, which is how the browser reports a cut: `scrollWidth` past `clientWidth`. */
const isCut = (box: HTMLElement) => box.scrollWidth > box.clientWidth;

/** The whole words of a cut text standing under a point of the viewport, or nothing where none does. */
type Probe = (x: number, y: number) => string | undefined;

/** The probes of one row whose link stretches over it (`CutRow`). */
const RowProbes = createContext<Set<Probe> | null>(null);

/**
 * A row whose link stretches over the whole of it, as a table's linked row does (`Link`'s `row`): the pointer stands on
 * that link wherever it is on the row, so a cut text in another cell never sees it arrive, and the browser takes a
 * tooltip from the link's ancestors alone. Each cut text inside says, by its own box, whether a point stands over it
 * while it is cut, and what holds the link, the only part the pointer reaches, a cut text or a `CutHost`, carries the
 * words under the pointer in its `title`. The row stays one link, to a click, the keyboard and a screen reader alike; no part is lifted over it.
 */
export function CutRow({ children }: { children: ReactNode }) {
  const [probes] = useState(() => new Set<Probe>());
  return <RowProbes value={probes}>{children}</RowProbes>;
}

/** The cut words under the pointer, asked of every cut text in the row as the pointer moves, for a `title`. */
function useWordsUnderPointer(probes: Set<Probe> | null) {
  const [words, setWords] = useState<string>();
  const onPointerMove = (event: PointerEvent<HTMLSpanElement>) => {
    if (probes === null) return;
    const { clientX, clientY } = event;
    setWords([...probes].map((probe) => probe(clientX, clientY)).find((found) => found !== undefined));
  };
  return [words, setWords, onPointerMove] as const;
}

/**
 * What holds a `CutRow`'s stretched link where no cut text does, as a way's own name on Kontakt's rows (`LinkRows`):
 * the pointer reaches it alone, so it carries the cut words under the pointer in its `title`, as a cut text holding
 * the link does.
 */
export function CutHost({ className, children }: { className: string; children: ReactNode }) {
  const [title, , onPointerMove] = useWordsUnderPointer(use(RowProbes));
  return (
    <span
      className={className}
      title={title}
      onPointerMove={onPointerMove}>
      {children}
    </span>
  );
}

/**
 * Words cut with „…“ where their line is too narrow, a name in a row or a head: whole in the browser's tooltip only
 * while they are cut, judged as the pointer arrives, so a name shown in full is never repeated in a tooltip over
 * it. Inside a `CutRow` the tooltip is the cut words under the pointer, whichever cell they stand in, judged as the
 * pointer moves. `children` is what is drawn, the words themselves or the link holding them.
 */
export function CutText({ text, className, id, children }: { text: string; className: string; id?: string; children?: ReactNode }) {
  const probes = use(RowProbes);
  const box = useRef<HTMLSpanElement>(null);
  const [title, setTitle, underPointer] = useWordsUnderPointer(probes);
  useEffect(() => {
    if (probes === null) return;
    const probe: Probe = (x, y) => {
      const own = box.current;
      if (own === null) return undefined;
      const { left, right, top, bottom } = own.getBoundingClientRect();
      return x >= left && x <= right && y >= top && y <= bottom && isCut(own) ? text : undefined;
    };
    probes.add(probe);
    return () => {
      probes.delete(probe);
    };
  }, [probes, text]);
  return (
    <span
      ref={box}
      id={id}
      className={className}
      title={title}
      onPointerEnter={probes === null ? (event) => setTitle(isCut(event.currentTarget) ? text : undefined) : undefined}
      onPointerMove={probes === null ? undefined : underPointer}>
      {children ?? text}
    </span>
  );
}
