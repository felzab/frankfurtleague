"use client";

import { createContext, useContext, useEffect, useState } from "react";

import { Focusable } from "react-aria-components/Focusable";

import { COPY } from "@/core/copy";

import { Button } from "./Button";
import { RAIL_ID } from "./railStyles";
import { Tooltip } from "./Tooltip";
import { tv } from "./tv";
import { useDesktop } from "./useDesktop";

import type { Copy } from "@/core/copy";
import type { ComponentProps, ReactNode } from "react";

const RailContext = createContext<{ collapsed: boolean; toggle: () => void } | null>(null);

/**
 * Whether the rail stands collapsed to its glyphs, and the toggle flipping it: read by the strip's toggle
 * and by a rail link's tooltip, which opens only while the link's words are clipped. `null` outside a rail
 * frame.
 */
function useRail() {
  return useContext(RailContext);
}

/** Whether the rail stands collapsed, for a rail part whose menu then opens beside the rail; `false` outside a rail frame. */
export function useRailCollapsed() {
  return useRail()?.collapsed === true;
}

/**
 * The rail's width, from the measures `tokens.css` declares on the root, switched to its collapsed width by
 * the collapsed attribute; the grid's columns follow it over the entrance's 200 ms, since a 100-ms state
 * change over 184 px reads as a jump. Under reduced motion the motion token is unset and the width snaps.
 */
const root = tv({
  base: "group min-h-dvh data-collapsed:[--rail-width:var(--rail-width-collapsed)] lg:grid lg:grid-cols-[var(--rail-width)_minmax(0,1fr)] lg:transition-[grid-template-columns] lg:duration-(--motion-in)",
});

/**
 * The rail frame's root, holding its one piece of client state: whether the rail is collapsed, as one
 * attribute on this element, which the rail's parts style against with `group-data-collapsed:`. The choice
 * is not stored: every page load starts expanded, and it holds while the visitor moves between the frame's
 * pages because Next keeps a layout mounted. Ctrl+B, and Cmd+B on a Mac, flip it from anywhere on the page,
 * as shadcn/ui's sidebar does, so the listener is the window's rather than the toggle's; only where the rail
 * stands, so a phone's keyboard keeps the browser's own Ctrl+B and no hidden rail folds unseen.
 */
export function RailRoot({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const isDesktop = useDesktop();

  useEffect(() => {
    if (!isDesktop) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "b" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setCollapsed((is) => !is);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isDesktop]);

  return (
    <RailContext value={{ collapsed, toggle: () => setCollapsed((is) => !is) }}>
      <div
        data-collapsed={collapsed || undefined}
        className={root()}>
        {children}
      </div>
    </RailContext>
  );
}

/**
 * The strip's toggle folding the rail to its glyphs and back, before the page title in both states, at the
 * strip's start as shadcn/ui's sidebar trigger stands: the 36-px box reaches 24 px into the strip's 32-px
 * inset, so it starts 8 px from the rail and its 16-px glyph 18 px, and hangs 10 px into the 16-px gap, so
 * the glyph stands 16 px before the title. Desktop only: a phone's drawer has no rail to fold.
 */
export function RailToggle() {
  const rail = useRail();
  if (rail === null) return null;
  return (
    <span className="-mr-2.5 -ml-6 max-lg:hidden">
      <Button
        icon="seitenleiste"
        label={rail.collapsed ? COPY.vorlage.seitenleiste.ausklappen : COPY.vorlage.seitenleiste.einklappen}
        aria-expanded={!rail.collapsed}
        aria-controls={RAIL_ID}
        onPress={rail.toggle}
      />
    </span>
  );
}

/**
 * A rail link's name at its end while the rail is collapsed and its words are clipped; a plain link becomes
 * the tooltip's trigger through React Aria's `Focusable`, as its guide has for an element of its own.
 */
export function RailTooltip({ label, children }: { label: Copy; children: ComponentProps<typeof Focusable>["children"] }) {
  const rail = useRail();
  return (
    <Tooltip
      label={label}
      placement="end"
      isDisabled={rail?.collapsed !== true}>
      <Focusable>{children}</Focusable>
    </Tooltip>
  );
}
