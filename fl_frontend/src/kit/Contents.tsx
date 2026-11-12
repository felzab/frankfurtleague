"use client";

import { useEffect, useId, useState } from "react";

import { COPY } from "@/core/copy";

import { smallCaps } from "./cardStyles";
import { Link } from "./Link";
import { tv } from "./tv";

import type { Copy } from "@/core/copy";

/** One section a reading page's contents list names: its heading's words and the id its `section` carries. */
export type ContentsEntry = { id: string; title: Copy };

const rail = tv({
  slots: {
    // Sticking under the classic band, 32 px below it, while the text beside it scrolls.
    root: "sticky top-[calc(var(--classic-header)+2rem)] grid gap-3",
    label: smallCaps(),
    list: "grid",
  },
});

/**
 * The section the reader is in: the first, in the text's order, of the sections showing below the classic band. Each
 * section is watched by one `IntersectionObserver` (https://developer.mozilla.org/docs/Web/API/Intersection_Observer_API),
 * whose root is the screen less the band, read as each section's own scroll margin, which is the band's height; the
 * sections showing are kept as the observer reports them entering and leaving, so a jump past several sections marks the
 * one it lands on. The first section is marked before any report, as the page opens on it.
 */
function useCurrentSection(entries: readonly ContentsEntry[]): string | undefined {
  const [current, setCurrent] = useState(entries[0]?.id);
  useEffect(() => {
    const ids = entries.map((entry) => entry.id);
    const sections = ids.map((id) => document.getElementById(id)).filter((section) => section !== null);
    const first = sections[0];
    if (first === undefined) return;
    const band = Number.parseFloat(getComputedStyle(first).scrollMarginTop);
    const showing = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) showing.add(entry.target.id);
          else showing.delete(entry.target.id);
        }
        const topmost = ids.find((id) => showing.has(id));
        if (topmost !== undefined) setCurrent(topmost);
      },
      { rootMargin: `-${String(band)}px 0px 0px 0px` },
    );
    for (const section of sections) observer.observe(section);
    return () => observer.disconnect();
  }, [entries]);
  return current;
}

/**
 * A reading page's contents list beside its text from `lg`: its label over a link to each section, the section the
 * reader is in marked, as Carbon's table of contents for IBM.com marks it. The page places it in the column beside the
 * text, which it follows down the page.
 */
export function ContentsRail({ entries }: { entries: readonly ContentsEntry[] }) {
  const slots = rail();
  const labelId = useId();
  const current = useCurrentSection(entries);
  return (
    <nav
      aria-labelledby={labelId}
      className={slots.root()}>
      <p
        id={labelId}
        className={slots.label()}>
        {COPY.template.contents}
      </p>
      <ol className={slots.list()}>
        {entries.map((entry) => (
          <li key={entry.id}>
            <Link
              href={`#${entry.id}`}
              placement="contents"
              label={entry.title}
              current={entry.id === current}
            />
          </li>
        ))}
      </ol>
    </nav>
  );
}
