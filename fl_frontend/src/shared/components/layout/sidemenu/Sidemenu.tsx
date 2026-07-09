"use client";

import React, { Suspense, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import { LayoutSideContentLeft } from "@gravity-ui/icons";

import { Button, Separator } from "@heroui/react";

import SidemenuLink from "./SidemenuLink";

import type { SidemenuStructure } from "@/shared/types/types";

export default function Sidemenu({
  structure,
  linkPrefix,
  saisonMetadataDisplay,
}: {
  structure: SidemenuStructure;
  linkPrefix: string;
  saisonMetadataDisplay: React.ReactNode;
}) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);

  // 1. SELECTIVE EXTRACTION: Only grab the parameters that are truly global
  const globalSaisonId = searchParams.get("saison_id");

  // 2. Build a clean, isolated query string just for the sidebar links
  const globalQuery = new URLSearchParams();
  if (globalSaisonId) {
    globalQuery.set("saison_id", globalSaisonId);
  }
  const queryString = globalQuery.toString();

  const _toggleSidemenu = () => setIsOpen(!isOpen);
  const _checkIsActive = (itemId: string) => {
    const targetPath = `${linkPrefix}/${itemId}`;
    return pathname === targetPath || pathname.startsWith(`${targetPath}/`); // requires trailing slash to prevent false positives like /spieler matching /spielerverwaltung
  };

  // 1. Get the path after the prefix (e.g., "teams/123/edit")
  // 2. Extract just the very first word (e.g., "teams")
  const baseSegment = pathname.replace(`${linkPrefix}/`, "").split("/")[0];
  // 3. Flatten the nested structure and find the label
  const activeOption = structure.flatMap((group) => group.sub_options).find((option) => option.id === baseSegment);
  // 4. Fallback if the route doesn't match anything in the menu
  const displayTitle = activeOption ? activeOption.label : "Dashboard";

  return (
    <>
      <header className="bg-secondary-light/80 dark:bg-secondary-dark/80 border-tertiary-light dark:border-tertiary-dark sticky top-0 mt-1.5 mb-1 flex w-[95%] items-center gap-3 self-center-safe rounded-xl border-y px-3 py-2 shadow-sm backdrop-blur-md xl:hidden">
        <Button
          isIconOnly
          onPress={_toggleSidemenu}
          className="bg-quaternary-light/50 dark:bg-quaternary-dark/50 rounded-lg p-2 transition-opacity hover:opacity-80"
          aria-label="Toggle Menu">
          <LayoutSideContentLeft className="text-text-black dark:text-text-white h-6 w-6" />
        </Button>

        <Separator
          orientation="vertical"
          className="bg-tertiary-light dark:bg-senary-dark h-full"
        />

        <h2 className="text-fluid-lg truncate font-semibold tracking-wide capitalize">{displayTitle}</h2>
      </header>

      {/* Backdrop: Only visible on mobile, when menu sidmenu is open */}
      <div
        onClick={_toggleSidemenu}
        className={`absolute inset-0 z-5 bg-black/50 transition-opacity duration-300 xl:hidden ${isOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"} `}
      />

      <aside
        className={`border-tertiary-light dark:border-tertiary-dark bg-secondary-light dark:bg-secondary-dark text-text-black dark:text-text-white fixed z-40 flex min-h-full w-full max-w-[80%] transform flex-col border-t-2 transition-transform duration-300 ease-in-out sm:max-w-[50%] lg:max-w-[30%] lg:duration-[0] xl:max-w-[380px] ${isOpen ? "translate-x-0" : "-translate-x-full"} xl:static xl:inset-auto xl:z-0 xl:translate-x-0`}>
        <Suspense fallback={<span className="text-fluid-xs h-[80px] opacity-80"> Daten laden...</span>}>{saisonMetadataDisplay}</Suspense>

        <div className="flex flex-col gap-6 p-4">
          {structure.map((group) => (
            /* Grouped by category */
            <div key={group.category_name}>
              <span className="text-fluid-sm font-bold uppercase">{group.category_name /* category header */}</span>

              {/* Actual selectable options */}
              <div className="flex flex-col gap-2">
                {group.sub_options.map((sub_option) => {
                  const targetPath = `${linkPrefix}/${sub_option.id}`;
                  const finalHref = queryString ? `${targetPath}?${queryString}` : targetPath;
                  return (
                    <SidemenuLink
                      toggleSidemenu={_toggleSidemenu}
                      key={sub_option.id}
                      itemId={sub_option.id}
                      itemLabel={sub_option.label}
                      isActive={_checkIsActive(sub_option.id)}
                      href={finalHref}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}
