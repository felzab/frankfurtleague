"use client";

import { useRef, useState } from "react";

import { flushSync } from "react-dom";

import { COPY } from "@/core/copy";

import { Button } from "./Button";
import { stacked } from "./cardStyles";

import type { ReactElement } from "react";

/** The most rows a card of open work shows before the rest is asked for, the low end of the five to ten the owner named. */
const CAP = 5;

/**
 * A card's rows of open work: the first five where it holds more, and under them „Alle anzeigen“, which shows the rest
 * in place, as Primer's `NavList.GroupExpand` and Carbon's "Show more" reveal a list's overflow. The card's head counts
 * every row, so the count says what the press will show. The button leaves with the rows it held back, so the press
 * hands the focus to the first row it showed, as `GroupExpand` does. Nothing is read again: the rows came with the
 * page, and only their showing waits.
 */
export function CappedRows({ rows }: { rows: ReadonlyArray<ReactElement> }) {
  const [isOpen, setOpen] = useState(false);
  const foot = useRef<HTMLDivElement>(null);
  if (isOpen || rows.length <= CAP) return rows;
  const showAll = () => {
    // The card's body, read before the button leaves it: its child after the shown rows is the first row the press shows.
    const body = foot.current?.parentElement;
    flushSync(() => setOpen(true));
    body?.children.item(CAP)?.querySelector<HTMLElement>("a[href]")?.focus();
  };
  return (
    <>
      {rows.slice(0, CAP)}
      <div
        ref={foot}
        className={stacked({ class: "px-4 py-3" })}>
        <Button
          variant="secondary"
          label={COPY.template.showAll}
          onPress={showAll}
        />
      </div>
    </>
  );
}
