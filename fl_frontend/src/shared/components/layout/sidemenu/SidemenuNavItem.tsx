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
  onMobileClick,
}: {
  href: string;
  label: string;
  isActive: boolean;
  isDesktopCollapsed: boolean;
  icon: React.ElementType | null;
  onMobileClick: () => void;
}) {
  const linkElement = (
    <Link
      onClick={onMobileClick}
      // Colour and weight alone are what assistive tech cannot see, and these are seven
      // identically-structured links with no other way to tell which is the current page.
      aria-current={isActive ? "page" : undefined}
      // Collapsed, this is a 36x36 square -- `w-9 justify-center`, what `SidemenuFooter`'s two
      // controls are (decided 2026-08-07). Under `w-full` the fill is a wide rectangle in the nav and
      // a neat square in the footer. Expanded, the row holds a label.
      className={`flex h-9 items-center rounded-md transition-colors ${
        isDesktopCollapsed ? "w-9 justify-center" : "w-full justify-start gap-2.5 px-3"
      } ${isActive ? "bg-brand/10 text-brand font-medium shadow-sm" : "text-foreground hover:bg-muted hover:text-foreground fluid-sm"}`}
      href={href}>
      {IconComponent && (
        <IconComponent
          aria-hidden="true"
          className={`h-[18px] w-[18px] shrink-0 ${isActive ? "text-brand opacity-100" : "opacity-70"}`}
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
