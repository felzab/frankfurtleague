"use client";

import React from "react";
import Link from "next/link";

import { IconTooltip } from "../../ui/IconTooltip";

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
      // Collapsed, this is the same square `SidemenuFooter`'s controls are: under `w-full` the fill would be
      // a wide rectangle in the nav beside neat squares in the footer.
      className={`flex h-9 items-center rounded-md transition-colors ${
        isDesktopCollapsed ? "w-9 justify-center" : "w-full justify-start gap-2.5 px-3"
      } ${isActive ? "bg-brand/10 text-brand font-medium shadow-sm" : "text-foreground hover:bg-hover hover:text-foreground fluid-sm"}`}
      href={href}>
      {IconComponent && (
        <IconComponent
          aria-hidden="true"
          className={`size-[18px] shrink-0 ${isActive ? "text-brand opacity-100" : "opacity-70"}`}
        />
      )}
      {!isDesktopCollapsed && <span className="fluid-sm truncate">{label}</span>}
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
