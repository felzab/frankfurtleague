"use client";

import NextLink from "next/link";

import { Focusable } from "react-aria-components/Focusable";

import { Icon } from "./Icon";
import { Tooltip } from "./Tooltip";

import type { Copy } from "@/core/copy";
import type { Route } from "next";
import type { IconName } from "./Icon";

/**
 * `Link`'s icon-only placement: a glyph alone, named by its label, which the kit's tooltip shows above it as
 * an icon-only button's; Next's link becomes the tooltip's trigger through React Aria's `Focusable`, as the
 * collapsed rail's links do. Client code, since the tooltip holds state: `Link` hands it plain props, so a
 * page of other links stays server-rendered with no React Aria.
 */
export function IconLink({ href, icon, label, className }: { href: Route; icon: IconName; label: Copy; className: string }) {
  return (
    <Tooltip label={label}>
      <Focusable>
        <NextLink
          href={href}
          aria-label={label}
          data-kit-focus="ring"
          className={className}>
          <Icon
            glyph={icon}
            size={16}
          />
        </NextLink>
      </Focusable>
    </Tooltip>
  );
}
