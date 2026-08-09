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
      // The active item was signalled by colour and weight alone, which assistive tech cannot see —
      // seven identically-structured links with no way to tell which is the current page.
      aria-current={isActive ? "page" : undefined}
      // Collapsed, this is a 36x36 SQUARE — `w-9 justify-center`, exactly what `SidemenuFooter`'s two
      // controls are (decided 2026-08-07). It was `w-full` before, which made the hover and active fill a
      // wide rectangle in the nav and a neat square four rows below it in the footer, and left the icon
      // looking cramped in a box far wider than tall. Expanded, `w-full` is right: the row holds a label.
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
