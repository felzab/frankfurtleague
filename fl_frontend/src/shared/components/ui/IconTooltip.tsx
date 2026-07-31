"use client";

import { Tooltip } from "@heroui/react";

import type { ReactNode } from "react";

/**
 * The one tooltip appearance. The content style was written 13 times in two drifted variants
 * (R4 §8.3) — different radius, padding, and one of them on the stock type scale in a codebase that
 * uses the fluid scale everywhere. The sidemenu variant wins because the fluid scale is the app's
 * convention.
 *
 * `isEnabled` resolves R4 §9.3's three-way structural split: the collapsed-sidemenu tooltips were
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
    <Tooltip delay={0}>
      <Tooltip.Trigger>{children}</Tooltip.Trigger>
      <Tooltip.Content
        placement={placement}
        className={`bg-surface border-border text-fluid-xs rounded-md border px-2.5 py-1 shadow-md ${tone === "danger" ? "text-danger" : "text-foreground"}`}>
        {label}
      </Tooltip.Content>
    </Tooltip>
  );
}
