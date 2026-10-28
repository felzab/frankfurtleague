"use client";

import NextLink from "next/link";
import { usePathname } from "next/navigation";

import { TAB_PARAM } from "./tabChoice";

import type { Copy } from "@/core/copy";
import type { ReactNode } from "react";

/**
 * Switching what a page shows, such as its matchday: a row of links in a `nav`, as GitHub Primer's
 * UnderlineNav builds navigation tabs, the chosen one marked `aria-current="page"`, and under the row the
 * chosen tab's content, the page's own. Each link is the page's address with the tab in it (`?tab=<id>`),
 * so Back, a reload and a shared link keep the view; the chosen tab is the one the server read from the
 * address (`chosenTab`). Plain links, because React Aria's tabs replace their server-rendered links when
 * they hydrate and drop a link click whose press they did not see begin: a press held across hydration did
 * nothing (adobe/react-spectrum#8239). On a phone the row scrolls sideways, and where the browser drives
 * animations from a scroll, the edge with more to read fades through the `kit-scroll-fade` keyframes in the
 * token file. The row's 1-px line is its background's bottom edge, so the chosen tab's 2-px mark, painted
 * over the background, covers it where the tab stands.
 */
export function Tabs({
  label,
  selectedKey,
  tabs,
  children,
}: {
  label: Copy;
  /** The tab the address names, or the one most likely wanted, chosen on the server by `chosenTab`. */
  selectedKey: string;
  /** Each tab's label is data, a matchday's name. */
  tabs: ReadonlyArray<{ id: string; label: string }>;
  /** The chosen tab's content, alone: the other tabs' content never reaches the page. */
  children: ReactNode;
}) {
  const pathname = usePathname();
  return (
    <div className="grid gap-4">
      {/* A grid item is as wide as its content unless told otherwise, so without `min-w-0` the row would widen
          the page on a phone rather than scroll inside it. */}
      <nav
        aria-label={label}
        className="min-w-0">
        <ul className="flex [scrollbar-width:none] gap-1 overflow-x-auto bg-[linear-gradient(var(--border),var(--border))] bg-size-[100%_1px] bg-bottom bg-no-repeat supports-[animation-timeline:scroll()]:[mask-image:linear-gradient(to_right,transparent,#000_var(--kit-fade-start),#000_calc(100%-var(--kit-fade-end)),transparent)] supports-[animation-timeline:scroll()]:[animation-fill-mode:both] supports-[animation-timeline:scroll()]:[animation-name:kit-scroll-fade] supports-[animation-timeline:scroll()]:[animation-timeline:scroll(self_inline)] supports-[animation-timeline:scroll()]:[animation-timing-function:linear]">
          {tabs.map((tab) => (
            <li
              key={tab.id}
              className="shrink-0">
              <NextLink
                href={`${pathname}?${new URLSearchParams({ [TAB_PARAM]: tab.id }).toString()}`}
                aria-current={tab.id === selectedKey ? "page" : undefined}
                data-kit-focus="inset"
                className="flex h-9 cursor-default items-center border-b-2 border-transparent px-3 text-sm font-medium whitespace-nowrap text-fg-muted transition-colors duration-(--motion-state) hover:text-fg aria-[current=page]:border-brand aria-[current=page]:text-fg pointer-coarse:h-11">
                {tab.label}
              </NextLink>
            </li>
          ))}
        </ul>
      </nav>
      {children}
    </div>
  );
}
