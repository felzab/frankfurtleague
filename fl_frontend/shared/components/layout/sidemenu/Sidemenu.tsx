"use client";

import SidemenuLink from "./SidemenuLink";
import { usePathname } from "next/navigation";
import React, { Suspense, useState } from "react";
import { Button, Separator } from "@heroui/react";
import { LayoutSideContentLeft } from "@gravity-ui/icons";
import type { SidemenuStructure } from "@/shared/types";

export default function Sidemenu({
  structure,
  linkPrefix,
  saisonMetadataDisplay,
}: {
  structure: SidemenuStructure;
  linkPrefix: string;
  saisonMetadataDisplay: React.ReactNode;
}) {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);

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
      <header className=" w-[95%] self-center-safe xl:hidden mt-1.5 rounded-xl sticky top-0 mb-1 flex items-center gap-3 px-3 py-2 bg-secondary-light/80 dark:bg-secondary-dark/80 backdrop-blur-md border-y border-tertiary-light dark:border-tertiary-dark shadow-sm">
        <Button
          isIconOnly
          onPress={_toggleSidemenu}
          className="p-2 rounded-lg bg-quaternary-light/50 dark:bg-quaternary-dark/50 hover:opacity-80 transition-opacity"
          aria-label="Toggle Menu">
          <LayoutSideContentLeft className="h-6 w-6 text-text-black dark:text-text-white" />
        </Button>

        <Separator
          orientation="vertical"
          className="h-full bg-tertiary-light dark:bg-senary-dark"
        />

        <h2 className="text-fluid-lg font-semibold capitalize tracking-wide truncate">{displayTitle}</h2>
      </header>

      {/* Backdrop: Only visible on mobile, when menu sidmenu is open */}
      <div
        onClick={_toggleSidemenu}
        className={`xl:hidden
          absolute inset-0 z-5 bg-black/50 transition-opacity duration-300
          ${isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}
        `}
      />

      <aside
        className={`
          z-40 fixed flex flex-col w-full max-w-[80%] sm:max-w-[50%] lg:max-w-[30%] xl:max-w-[380px]  min-h-full
          border-t-2 border-tertiary-light dark:border-tertiary-dark
          bg-secondary-light dark:bg-secondary-dark
          text-text-black dark:text-text-white
          transform transition-transform duration-300 lg:duration-[0] ease-in-out ${isOpen ? "translate-x-0" : "-translate-x-full"}
          xl:translate-x-0 xl:static xl:inset-auto xl:z-0

          `}>
        <Suspense fallback={<span className="text-fluid-xs opacity-80 h-[80px]"> Daten laden...</span>}>{saisonMetadataDisplay}</Suspense>

        <div className="flex flex-col gap-6 p-4">
          {structure.map((group) => (
            /* Grouped by category */
            <div key={group.category_name}>
              <span className="text-fluid-sm font-bold uppercase">{group.category_name /* category header */}</span>

              {/* Actual selectable options */}
              <div className="flex flex-col gap-2">
                {group.sub_options.map((sub_option) => {
                  return (
                    <SidemenuLink
                      toggleSidemenu={_toggleSidemenu}
                      key={sub_option.id}
                      itemId={sub_option.id}
                      itemLabel={sub_option.label}
                      isActive={_checkIsActive(sub_option.id)}
                      linkPrefix={linkPrefix}
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
