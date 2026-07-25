"use client";

import React, { Suspense, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { Separator } from "@heroui/react";

import { FLLogo } from "../../ui/FLLogo";
import SidemenuDesktopHeader from "./SidemenuDesktopHeader";
import SidemenuFooter from "./SidemenuFooter";
import SidemenuMobileHeader from "./SidemenuMobileHeader";
import SidemenuNavItem from "./SidemenuNavItem";

import type { SidemenuStructure } from "@/shared/types/types";

export default function Sidemenu({
  structure,
  linkPrefix,
  saisonMetadataDisplay,
  iconDictionary,
}: {
  structure: SidemenuStructure;
  linkPrefix: string;
  saisonMetadataDisplay: React.ReactNode;
  iconDictionary: Record<string, React.ElementType>;
}) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isDesktopCollapsed, setIsDesktopCollapsed] = useState(false);

  const globalSaisonId = searchParams.get("saison_id");
  const globalQuery = new URLSearchParams();
  if (globalSaisonId) {
    globalQuery.set("saison_id", globalSaisonId);
  }
  const queryString = globalQuery.toString();

  const _toggleMobileMenu = () => setIsMobileOpen(!isMobileOpen);
  const _toggleDesktopMenu = () => setIsDesktopCollapsed(!isDesktopCollapsed);
  const _checkIsActive = (itemId: string) => {
    const targetPath = `${linkPrefix}/${itemId}`;
    return pathname === targetPath || pathname.startsWith(`${targetPath}/`);
  };

  const baseSegment = pathname.replace(`${linkPrefix}/`, "").split("/")[0];
  const activeOption = structure.flatMap((g) => g.sub_options).find((o) => o.id === baseSegment);
  const displayTitle = activeOption ? activeOption.label : "Dashboard";

  return (
    <>
      <SidemenuMobileHeader
        displayTitle={displayTitle}
        onToggleMenu={_toggleMobileMenu}
      />

      {/* MOBILE BACKDROP */}
      <div
        onClick={_toggleMobileMenu}
        aria-hidden="true"
        className={`fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-300 xl:hidden ${
          isMobileOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      {/* CLOUDFLARE STYLE SIDEBAR */}
      <aside
        className={`bg-surface border-border text-foreground fixed inset-y-0 left-0 z-50 flex h-dvh flex-col border-r transition-[width,transform] duration-300 ease-in-out ${
          isMobileOpen ? "translate-x-0" : "-translate-x-full"
        } xl:relative xl:z-0 xl:shrink-0 xl:translate-x-0 ${isDesktopCollapsed ? "xl:w-[72px]" : "w-[310px]"}`}>
        <SidemenuDesktopHeader isDesktopCollapsed={isDesktopCollapsed} />

        {/* MOBILE DRAWER HEADER */}
        <div className="border-border flex h-14 shrink-0 items-center justify-between border-b px-4 xl:hidden">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="bg-brand flex h-7 w-7 items-center justify-center rounded text-[10px] font-bold text-white shadow-sm">
              <FLLogo />
            </Link>
            <span className="text-fluid-sm truncate font-semibold">Frankfurt-League</span>
          </div>
          <button
            onClick={() => setIsMobileOpen(false)}
            className="text-foreground-muted hover:bg-muted hover:text-foreground -mr-1 rounded-md p-1.5 transition-colors"
            aria-label="Close Menu">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              className="h-5 w-5">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* MAIN SCROLLABLE CONTENT */}
        <div className="flex flex-1 flex-col gap-6 overflow-x-hidden overflow-y-auto px-3 py-4">
          <Suspense fallback={<div className="bg-muted h-[70px] w-full animate-pulse rounded-xl" />}>
            <div className={`transition-all duration-300 ${isDesktopCollapsed ? "hidden h-0 xl:block xl:opacity-0" : "opacity-100"}`}>
              {!isDesktopCollapsed && <>{saisonMetadataDisplay}</>}
            </div>
          </Suspense>

          {/* Navigation Links */}
          <div className="flex flex-col gap-5">
            {structure.map((group) => (
              <div
                key={group.category_name}
                className="flex flex-col gap-1">
                {!isDesktopCollapsed ? (
                  <span className="text-foreground-muted text-fluid-sm px-2 pb-1 font-medium">{group.category_name}</span>
                ) : (
                  <Separator className="bg-border my-1 w-1/2 self-center" />
                )}

                <div className="flex flex-col gap-[2px]">
                  {group.sub_options.map((sub_option) => {
                    const targetPath = `${linkPrefix}/${sub_option.id}`;
                    const finalHref = queryString ? `${targetPath}?${queryString}` : targetPath;

                    return (
                      <SidemenuNavItem
                        key={sub_option.id}
                        href={finalHref}
                        label={sub_option.label}
                        isActive={_checkIsActive(sub_option.id)}
                        isDesktopCollapsed={isDesktopCollapsed}
                        icon={sub_option.iconName ? iconDictionary[sub_option.iconName] : null}
                        onMobileClick={() => setIsMobileOpen(false)}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <SidemenuFooter
          isDesktopCollapsed={isDesktopCollapsed}
          onToggleDesktopMenu={_toggleDesktopMenu}
        />
      </aside>
    </>
  );
}
