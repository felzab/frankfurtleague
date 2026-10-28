"use client";

import { Tabs as AriaTabs, Tab, TabList, TabPanel } from "react-aria-components/Tabs";

import type { Copy } from "@/core/copy";
import type { ReactNode } from "react";

/**
 * Switching matchday: one matchday at a time, opening on the one the server names. On a phone the row
 * scrolls sideways, and where the browser drives animations from a scroll, the edge with more to read
 * fades through the `kit-scroll-fade` keyframes in the token file. The row's 1-px line is its background's
 * bottom edge, so the chosen tab's 2-px mark, painted over the background, covers it where the tab stands.
 */
export function Tabs({
  label,
  defaultKey,
  tabs,
}: {
  label: Copy;
  /** The tab most likely wanted, computed on the server: the current matchday. */
  defaultKey: string;
  /** Each tab's label is data, a matchday's name; its panel holds the kit's blocks. */
  tabs: ReadonlyArray<{ id: string; label: string; panel: ReactNode }>;
}) {
  return (
    <AriaTabs
      defaultSelectedKey={defaultKey}
      className="grid gap-4">
      <TabList
        aria-label={label}
        data-kit-focus
        className="flex [scrollbar-width:none] gap-1 overflow-x-auto bg-[linear-gradient(var(--border),var(--border))] bg-size-[100%_1px] bg-bottom bg-no-repeat supports-[animation-timeline:scroll()]:[mask-image:linear-gradient(to_right,transparent,#000_var(--kit-fade-start),#000_calc(100%-var(--kit-fade-end)),transparent)] supports-[animation-timeline:scroll()]:[animation-fill-mode:both] supports-[animation-timeline:scroll()]:[animation-name:kit-scroll-fade] supports-[animation-timeline:scroll()]:[animation-timeline:scroll(self_inline)] supports-[animation-timeline:scroll()]:[animation-timing-function:linear]">
        {tabs.map((tab) => (
          <Tab
            key={tab.id}
            id={tab.id}
            data-kit-focus="inset"
            className="flex h-9 shrink-0 cursor-default items-center border-b-2 border-transparent px-3 text-sm font-medium whitespace-nowrap text-fg-muted transition-colors duration-(--motion-state) data-hovered:text-fg data-selected:border-brand data-selected:text-fg pointer-coarse:h-11">
            {tab.label}
          </Tab>
        ))}
      </TabList>
      {tabs.map((tab) => (
        <TabPanel
          key={tab.id}
          id={tab.id}
          data-kit-focus="ring">
          {tab.panel}
        </TabPanel>
      ))}
    </AriaTabs>
  );
}
