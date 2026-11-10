import NextLink from "next/link";

import { COPY } from "@/core/copy";

import { hoverLook } from "./hoverStyles";
import { PlaceholderLine } from "./Skeleton";
import { TAB_PARAM } from "./tabChoice";
import { tv } from "./tv";

import type { Copy } from "@/core/copy";
import type { ReactNode } from "react";

/**
 * The tab row's look, which the tabs and their placeholder share: the row's 1-px line is its background's bottom
 * edge, so the chosen tab's 2-px mark, painted over the background, covers it where the tab stands; each tab as
 * tall as every control.
 */
const tabs = tv({
  slots: {
    // A grid item is as wide as its content unless told otherwise, so without `min-w-0` the row would widen the page
    // on a phone rather than scroll inside it.
    row: "flex min-w-0 gap-1 bg-[linear-gradient(var(--border),var(--border))] bg-size-[100%_1px] bg-bottom bg-no-repeat",
    tab: "flex h-8 shrink-0 items-center border-b-2 border-transparent px-3 text-sm font-medium whitespace-nowrap pointer-coarse:h-10",
  },
});

/**
 * The tabs while their labels are read: the row's own line with `count` tabs, and under it the placeholder of the
 * chosen tab's content, as `Tabs` sets the chosen tab's content under its row. A label comes from the read, so each
 * bar is sized by the words its tab most likely holds, its place's matchday, the one thing tabs wait for.
 */
export function TabsPlaceholder({ count, children }: { count: number; children: ReactNode }) {
  const { row, tab } = tabs();
  return (
    <div className="grid gap-4">
      <div className={row({ class: "overflow-hidden" })}>
        {Array.from({ length: count }, (_, index) => (
          <span
            key={index}
            className={tab()}>
            <PlaceholderLine
              textClass="text-sm"
              words={COPY.shared.spieltag(index + 1)}
            />
          </span>
        ))}
      </div>
      {children}
    </div>
  );
}

/**
 * Switching what a page shows, such as its matchday: a row of links in a `nav`, as GitHub Primer's
 * UnderlineNav builds navigation tabs, the chosen one marked `aria-current="page"`, and under the row the
 * chosen tab's content, the page's own. Each link is the tab alone, `?tab=<id>`, which the browser and
 * Next's router alike resolve against the page's own address, so Back, a reload and a shared link keep the
 * view; the chosen tab is the one the server read from the
 * address (`chosenTab`). Plain links, because React Aria's tabs replace their server-rendered links when
 * they hydrate and drop a link click whose press they did not see begin: a press held across hydration did
 * nothing (adobe/react-spectrum#8239). On a phone the row scrolls sideways, and where the browser drives
 * animations from a scroll, the edge with more to read fades through the `kit-scroll-fade` keyframes in the
 * token file.
 */
export function Tabs({
  label,
  selectedKey,
  tabs: entries,
  scroll = true,
  children,
}: {
  label: Copy;
  /**
   * Next's link's own `scroll`: whether choosing a tab lets Next scroll to the page's first element where it
   * is out of view, which Next's link does by default, or leaves the page where the reader stands. The
   * default is the board's to settle.
   */
  scroll?: boolean;
  /** The tab the address names, or the one most likely wanted, chosen on the server by `chosenTab`. */
  selectedKey: string;
  /** Each tab's label, a matchday's name. */
  tabs: ReadonlyArray<{ id: string; label: Copy }>;
  /** The chosen tab's content, alone: the other tabs' content never reaches the page. */
  children: ReactNode;
}) {
  const { row, tab } = tabs();
  return (
    <div className="grid gap-4">
      <nav
        aria-label={label}
        className="min-w-0">
        <ul
          className={row({
            class:
              "[scrollbar-width:none] overflow-x-auto supports-[animation-timeline:scroll()]:[mask-image:linear-gradient(to_right,transparent,#000_var(--kit-fade-start),#000_calc(100%-var(--kit-fade-end)),transparent)] supports-[animation-timeline:scroll()]:[animation-fill-mode:both] supports-[animation-timeline:scroll()]:[animation-name:kit-scroll-fade] supports-[animation-timeline:scroll()]:[animation-timeline:scroll(self_inline)] supports-[animation-timeline:scroll()]:[animation-timing-function:linear]",
          })}>
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="shrink-0">
              <NextLink
                href={`?${new URLSearchParams({ [TAB_PARAM]: entry.id }).toString()}`}
                scroll={scroll}
                aria-current={entry.id === selectedKey ? "page" : undefined}
                data-kit-focus="inset"
                className={tab({
                  class: `text-fg-muted transition-colors duration-(--motion-state) ${hoverLook({ host: "link", answer: "full" })} aria-[current=page]:border-brand aria-[current=page]:text-fg`,
                })}>
                {entry.label}
              </NextLink>
            </li>
          ))}
        </ul>
      </nav>
      {children}
    </div>
  );
}
