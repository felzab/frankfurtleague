"use client";

import { Tooltip } from "@heroui/react";

import { HINT_SURFACE } from "./hintSurface";

import type { ReactNode } from "react";

/**
 * The one tooltip appearance. The content style was written 13 times in two drifted variants
 * — different radius, padding, and one of them on the stock type scale in a codebase that
 * uses the fluid scale everywhere. The sidemenu variant wins because the fluid scale is the app's
 * convention.
 *
 * `isEnabled` resolves a three-way structural split: the collapsed-sidemenu tooltips were
 * conditional at two sites, unconditional at a third and an early-return at a fourth, all for the
 * same behaviour. Callers now pass the condition instead of branching on it.
 */
export function IconTooltip({
  label,
  placement = "top",
  tone,
  isEnabled = true,
  children,
}: {
  label: string;
  placement?: "top" | "right" | "bottom" | "left";
  tone?: "danger";
  isEnabled?: boolean;
  children: ReactNode;
}) {
  if (!isEnabled) return <>{children}</>;

  return (
    /* `closeDelay` is stated rather than left to HeroUI, which resolves it from a CSS time and so
       varies with the theme (decided 2026-08-07: 200ms everywhere). `delay={0}` is the open delay:
       these labels name an icon the user is already pointing at. */
    <Tooltip
      delay={0}
      closeDelay={200}>
      {/* `tabIndex={-1}` and `role="presentation"` are load-bearing, not tidying.
          `Tooltip.Trigger` renders `<div role="button">` and runs react-aria's `useFocusable`, which
          hands it `tabIndex: 0` unconditionally (HeroUI 3.2.2, `tooltip.js`). Every child here is
          already an interactive, labelled control, so the wrapper was adding a SECOND tab stop with
          no accessible name in front of each one — doubling the tab stops in an admin table's
          action cluster — and `role="button"` around an `<a>`/`<button>` is nested interactive content.
          `props` is spread after `mergeProps(focusableProps, props)`, so these two win.
          The tooltip still opens on hover and on focus: React's synthetic focus events bubble, so
          the wrapper sees the inner control being focused. */}
      <Tooltip.Trigger
        tabIndex={-1}
        role="presentation">
        {children}
      </Tooltip.Trigger>
      {/* The surface is shared with `DisabledHint`, whose popover answers the same question on a
          phone: a reader should not be able to tell which mechanism drew the panel. */}
      <Tooltip.Content
        placement={placement}
        className={`${HINT_SURFACE} ${tone === "danger" ? "text-danger" : "text-foreground"}`}>
        {label}
      </Tooltip.Content>
    </Tooltip>
  );
}
