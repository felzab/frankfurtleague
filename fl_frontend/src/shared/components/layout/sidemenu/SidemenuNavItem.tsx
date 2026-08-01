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
      className={`flex h-[36px] w-full items-center rounded-md transition-colors ${
        isDesktopCollapsed ? "justify-center px-0" : "justify-start gap-2.5 px-3"
      } ${isActive ? "bg-brand/10 text-brand font-medium shadow-sm" : "text-foreground hover:bg-muted hover:text-foreground text-fluid-sm"}`}
      href={href}>
      {IconComponent && (
        <IconComponent
          aria-hidden="true"
          className={`h-[18px] w-[18px] shrink-0 ${isActive ? "text-brand opacity-100" : "opacity-70"}`}
        />
      )}
      {!isDesktopCollapsed && <span className="text-fluid-sm truncate">{label}</span>}
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
