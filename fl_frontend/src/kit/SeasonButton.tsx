"use client";

import { Button as AriaButton } from "react-aria-components/Button";
import { tv } from "tailwind-variants/lite";

import { COPY } from "@/core/copy";

import { Icon } from "./Icon";
import { Menu } from "./Menu";

import type { Route } from "next";

const trigger = tv({
  slots: {
    root: "inline-flex h-9 items-center justify-between gap-2 rounded-lg border px-3 text-sm font-medium whitespace-nowrap transition-colors duration-(--motion-state) pointer-coarse:h-11",
    arrow: "flex",
  },
  variants: {
    // In the rail on the page's ground, or on the phone's dark-green band.
    placement: {
      rail: { root: "w-full border-border-control bg-bg text-fg data-hovered:bg-bg-muted", arrow: "text-fg-muted" },
      band: { root: "border-on-brand/45 bg-transparent text-on-brand", arrow: "text-on-brand/80" },
    },
    // With one season there is nowhere to switch to, yet it stays a menu: its arrow is dimmed.
    single: {
      true: { arrow: "opacity-45" },
    },
  },
});

/**
 * Switching season, at the top of the rail or in the phone's top band: always a menu, even with one
 * season. Each entry is the same page in that season, which the page computes.
 */
export function SeasonButton({
  current,
  seasons,
  placement,
}: {
  /** The season shown, as the formatting module writes it. */
  current: string;
  seasons: ReadonlyArray<{ text: string; href: Route; isCurrent: boolean }>;
  placement: "rail" | "band";
}) {
  const { root, arrow } = trigger({ placement, single: seasons.length < 2 });
  return (
    <Menu
      label={COPY.shared.saison}
      placement="below"
      groups={[seasons.map((season) => ({ kind: "link" as const, ...season }))]}
      trigger={
        <AriaButton
          data-kit-focus="ring"
          className={root()}>
          {current}
          <span className={arrow()}>
            <Icon
              glyph="aufklappen"
              size={16}
            />
          </span>
        </AriaButton>
      }
    />
  );
}
