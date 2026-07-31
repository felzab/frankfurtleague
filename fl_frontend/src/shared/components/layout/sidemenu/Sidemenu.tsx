"use client";

import React, { Suspense, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import { Separator } from "@heroui/react";

import SidemenuDesktopHeader from "./SidemenuDesktopHeader";
import { SidemenuDrawerHeader } from "./SidemenuDrawerHeader";
import SidemenuFooter from "./SidemenuFooter";
import SidemenuMobileHeader from "./SidemenuMobileHeader";
import SidemenuNavItem from "./SidemenuNavItem";

import type { SidemenuStructure } from "@/shared/types/types";

// Generic over the icon key: the structure and the dictionary are checked against each other, so
// iconDictionary[iconName] is a total lookup and cannot miss.
export default function Sidemenu<TIcon extends string>({
  structure,
  linkPrefix,
  saisonMetadataDisplay,
  iconDictionary,
}: {
  structure: SidemenuStructure<TIcon>;
  linkPrefix: string;
  saisonMetadataDisplay: React.ReactNode;
  iconDictionary: Record<TIcon, React.ElementType>;
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
        className={`fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-300 lg:hidden ${
          isMobileOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      {/* CLOUDFLARE STYLE SIDEBAR */}
      <aside
        className={`bg-surface border-border text-foreground fixed inset-y-0 left-0 z-50 flex h-dvh flex-col border-r transition-[width,transform] duration-300 ease-in-out ${
          isMobileOpen ? "translate-x-0" : "-translate-x-full"
        } lg:relative lg:z-0 lg:shrink-0 lg:translate-x-0 ${isDesktopCollapsed ? "lg:w-sidemenu-collapsed" : "w-sidemenu"}`}>
        <SidemenuDesktopHeader isDesktopCollapsed={isDesktopCollapsed} />

        <SidemenuDrawerHeader onClose={() => setIsMobileOpen(false)} />

        {/* MAIN SCROLLABLE CONTENT */}
        <div className="flex flex-1 scrollbar-gutter-stable flex-col gap-6 overflow-x-hidden overflow-y-auto px-3 py-4">
          <Suspense fallback={<div className="bg-muted h-[70px] w-full animate-pulse rounded-xl" />}>
            <div className={`transition-all duration-300 ${isDesktopCollapsed ? "hidden h-0 lg:block lg:opacity-0" : "opacity-100"}`}>
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
                        icon={iconDictionary[sub_option.iconName]}
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
