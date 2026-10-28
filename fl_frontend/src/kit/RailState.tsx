"use client";

import { createContext, useContext, useEffect, useState } from "react";

import { Focusable } from "react-aria-components/Focusable";

import { COPY } from "@/core/copy";

import { Button } from "./Button";
import { RAIL_ID } from "./railStyles";
import { Tooltip } from "./Tooltip";
import { tv } from "./tv";

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

/**
 * The frame's measures, declared once for the parts drawn to them and for the toasts placed under them: the
 * phone's band, the desktop rail's width and its head, which the title strip shares, and the signed-in rail
 * foot's height, which an editor's bar takes too, so the two top hairlines are one line: its 1-px edge, its
 * 8-px and 12-px padding, and the 48-px account row. The rail's width is one of two tokens, switched by the
 * collapsed attribute, and the grid's columns follow it over the entrance's 200 ms: a 100-ms state change
 * over 184 px reads as a jump. Under reduced motion the token is unset and the width snaps.
 */
const root = tv({
  base: "group min-h-dvh [--rail-band:3.5rem] [--rail-foot:calc(1px+0.5rem+0.75rem+3rem)] [--rail-strip:3rem] [--rail-width:var(--container-rail)] data-collapsed:[--rail-width:var(--container-rail-collapsed)] lg:grid lg:grid-cols-[var(--rail-width)_minmax(0,1fr)] lg:transition-[grid-template-columns] lg:duration-(--motion-in)",
});

/**
 * The rail frame's root, holding its one piece of client state: whether the rail is collapsed, as one
 * attribute on this element, which the rail's parts style against with `group-data-collapsed:`. The choice
 * is not stored: every page load starts expanded, and it holds while the visitor moves between the frame's
 * pages because Next keeps a layout mounted. Ctrl+B, and Cmd+B on a Mac, flip it from anywhere on the page,
 * as shadcn/ui's sidebar does, so the listener is the window's rather than the toggle's.
 */
export function RailRoot({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "b" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setCollapsed((is) => !is);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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
 * The strip's toggle folding the rail to its glyphs and back, before the page title in both states. The
 * 36-px box hangs 10 px into the strip's 32-px inset and its 16-px gap, so the 16-px glyph, not the box,
 * stands on the content's line, 16 px before the title. Desktop only: a phone's drawer has no rail to fold.
 */
export function RailToggle() {
  const rail = useRail();
  if (rail === null) return null;
  return (
    <span className="-mx-2.5 max-lg:hidden">
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
