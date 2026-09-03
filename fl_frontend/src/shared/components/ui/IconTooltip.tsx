"use client";

import { Tooltip } from "@heroui/react";

import { HINT_SURFACE } from "./hintSurface";

import type { ReactNode } from "react";

/**
 * The one tooltip appearance, for a control that already carries this label and owns its own press. Where the hint
 * owns it, `Hint`'s `reveal` mode carries why (COR-2). `isEnabled` takes the condition, so a caller does not branch
 * around the wrapper.
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
    /* `closeDelay` is stated rather than left to HeroUI, which resolves it from a CSS time and so varies with
       the theme. `delay={0}` is the open delay: these labels name an icon the user is already pointing at. */
    <Tooltip
      delay={0}
      closeDelay={200}>
      {/* Load-bearing: `Tooltip.Trigger` renders a `<div role="button">` with `tabIndex: 0`, so around an
          already-labelled control it adds a second, nameless tab stop and nests interactive content. */}
      <Tooltip.Trigger
        tabIndex={-1}
        role="presentation">
        {children}
      </Tooltip.Trigger>
      {/* The surface is shared with `Hint`'s refusal panel, so a reader cannot tell which mechanism drew the panel. */}
      <Tooltip.Content
        placement={placement}
        className={`${HINT_SURFACE} ${tone === "danger" ? "text-danger" : "text-foreground"}`}>
        {label}
      </Tooltip.Content>
    </Tooltip>
  );
}
