"use client";

import { useEffect, useId, useState } from "react";

import { COPY } from "@/core/copy";

import { cardSurface, smallCaps } from "./cardStyles";
import { Icon } from "./Icon";
import { Link } from "./Link";
import { tv } from "./tv";

import type { Copy } from "@/core/copy";

/** One section a reading page's contents list names: its heading's words and the id its `section` carries. */
export type ContentsEntry = { id: string; title: Copy };

const contents = tv({
  slots: {
    // Beside the text from `lg`, in the reading grid's second column, sticking 32 px under the classic band while the
    // text scrolls; a sticky grid item travels its grid area, which is the text's height.
    rail: "sticky top-[calc(var(--classic-header)+2rem)] hidden gap-3 self-start lg:col-start-2 lg:row-start-1 lg:grid",
    label: smallCaps(),
    // Over the text below `lg`: a native disclosure, which needs no script; its summary holds no heading, which a
    // summary would hide from some readers.
    fold: "lg:hidden",
    details: cardSurface({ class: "group/fold" }),
    summary: "flex min-h-12 cursor-pointer list-none items-center justify-between px-4 text-sm font-medium [&::-webkit-details-marker]:hidden",
    chevron: "flex text-fg-muted transition-transform duration-(--motion-state) group-open/fold:rotate-180",
    folded: "border-t border-border p-4",
  },
});

/**
 * The section the reader is in, by Bootstrap 4's scrollspy (`_process` in its `js/src/scrollspy.js`): at the page's end
 * the last section, since a short last section never reaches the top; otherwise the last whose top has reached the band
 * line, as GitHub's docs read their headings on each scroll event (`useActiveSection` in `github/docs`). The line is the
 * band's height, read from a section's own scroll margin, which is where a jump to it lands.
 *
 * A section a link names, clicked or opened by its address, is marked at once and stays marked while it stands where
 * the jump left it: its top on the line, or, at the page's end, below it, which a section too near the end stops at.
 * The reader's first scroll moves it off, and the scroll rule marks again.
 */
function useCurrentSection(entries: readonly ContentsEntry[]): string | undefined {
  const [current, setCurrent] = useState(entries[0]?.id);
  useEffect(() => {
    const sections = entries.map((entry) => document.getElementById(entry.id)).filter((section) => section !== null);
    const first = sections[0];
    if (first === undefined) return;
    const named = (hash: string) => sections.find((section) => `#${section.id}` === hash);
    let pinned = named(location.hash);
    const mark = () => {
      // Read on each scroll, since the band is taller from `lg`.
      const line = Number.parseFloat(getComputedStyle(first).scrollMarginTop);
      const below = (section: Element) => section.getBoundingClientRect().top - line;
      const end = scrollY + innerHeight >= document.documentElement.scrollHeight - 1;
      // A pixel's leeway, for a top a jump leaves a fraction off the line.
      if (pinned !== undefined && !(Math.abs(below(pinned)) <= 1 || (end && below(pinned) > 0))) pinned = undefined;
      setCurrent((pinned ?? (end ? sections.at(-1) : sections.findLast((section) => below(section) <= 1)) ?? first).id);
    };
    const pin = (event: MouseEvent) => {
      const section = event.target instanceof Element ? named(event.target.closest("a")?.hash ?? "") : undefined;
      if (section === undefined) return;
      pinned = section;
      setCurrent(section.id);
    };
    mark();
    addEventListener("scroll", mark, { passive: true });
    document.addEventListener("click", pin);
    return () => {
      removeEventListener("scroll", mark);
      document.removeEventListener("click", pin);
    };
  }, [entries]);
  return current;
}

function Entries({ entries, current }: { entries: readonly ContentsEntry[]; current: string | undefined }) {
  return (
    <ol>
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
  );
}

/**
 * A reading page's contents list: from `lg` a rail beside the text, its label over a link to each section, as Carbon's
 * table of contents for IBM.com stands; below it one row over the text, which opens on the same links, as Carbon's turns
 * compact on small screens. Both mark the section the reader is in; one shows at a time.
 */
export function Contents({ entries }: { entries: readonly ContentsEntry[] }) {
  const slots = contents();
  const labelId = useId();
  const current = useCurrentSection(entries);
  return (
    <>
      <nav
        aria-label={COPY.template.contents}
        className={slots.fold()}>
        <details className={slots.details()}>
          <summary
            data-kit-focus="inset"
            className={slots.summary()}>
            {COPY.template.contents}
            <span className={slots.chevron()}>
              <Icon
                glyph="expand"
                size={16}
              />
            </span>
          </summary>
          <div className={slots.folded()}>
            <Entries
              entries={entries}
              current={current}
            />
          </div>
        </details>
      </nav>
      <nav
        aria-labelledby={labelId}
        className={slots.rail()}>
        <p
          id={labelId}
          className={slots.label()}>
          {COPY.template.contents}
        </p>
        <Entries
          entries={entries}
          current={current}
        />
      </nav>
    </>
  );
}
