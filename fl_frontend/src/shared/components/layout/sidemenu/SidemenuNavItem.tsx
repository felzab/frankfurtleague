"use client";

import React from "react";
import Link from "next/link";

import { IconTooltip } from "../../ui/IconTooltip";
import { RAIL_SQUARE_RING_CLASSES } from "./railGutter";

export function SidemenuNavItem({
  href,
  label,
  isActive,
  isDesktopCollapsed,
  icon: IconComponent,
  onMobileNavigate,
}: {
  href: string;
  label: string;
  isActive: boolean;
  isDesktopCollapsed: boolean;
  icon: React.ElementType | null;
  onMobileNavigate: () => void;
}) {
  const linkElement = (
    <Link
      // `onNavigate`, not `onClick`: a modified click navigates nothing here, and closing the drawer on
      // one takes the navigation away from a visitor who never left the page.
      onNavigate={onMobileNavigate}
      // Colour and weight are what assistive tech cannot see, and every link here is structurally identical.
      aria-current={isActive ? "page" : undefined}
      // In every state rather than only collapsed: there the glyph is hidden and the tooltip names nothing to
      // assistive tech, and a name that follows the label's visibility is one a later edit can drop.
      aria-label={label}
      // Collapsed, this is the same square `SidemenuFooter`'s controls are: under `w-full` the fill would be
      // a wide rectangle in the nav beside neat squares in the footer.
      className={`flex h-9 items-center rounded-md transition-colors ${
        isDesktopCollapsed ? `w-9 justify-center ${RAIL_SQUARE_RING_CLASSES}` : "w-full justify-start gap-2 px-3"
      } ${isActive ? "bg-brand/15 font-medium text-brand shadow-sm" : "fluid-sm text-foreground hover:bg-hover hover:text-foreground"}`}
      href={href}>
      {IconComponent && (
        <IconComponent
          aria-hidden="true"
          className={`size-4.5 shrink-0 ${isActive ? "text-brand opacity-100" : "opacity-70"}`}
        />
      )}
      {!isDesktopCollapsed && <span className="truncate fluid-sm">{label}</span>}
    </Link>
  );

  return (
    <IconTooltip
      label={label}
      placement="right"
      isEnabled={isDesktopCollapsed}>
      {linkElement}
    </IconTooltip>
  );
}
