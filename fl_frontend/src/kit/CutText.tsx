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
 * while it is cut, and the one holding the link, the only one the pointer reaches, carries the words under the pointer
 * in its `title`. The row stays one link, to a click, the keyboard and a screen reader alike; no part is lifted over it.
 */
export function CutRow({ children }: { children: ReactNode }) {
  const [probes] = useState(() => new Set<Probe>());
  return <RowProbes value={probes}>{children}</RowProbes>;
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
  const [title, setTitle] = useState<string>();
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
  const underPointer = (event: PointerEvent<HTMLSpanElement>) => {
    if (probes === null) return;
    const { clientX, clientY } = event;
    setTitle([...probes].map((probe) => probe(clientX, clientY)).find((words) => words !== undefined));
  };
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
