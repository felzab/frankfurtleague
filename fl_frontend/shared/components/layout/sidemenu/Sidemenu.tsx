"use client";

import SidemenuLink from "./SidemenuLink";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Separator } from "@heroui/react";
import { LayoutSideContentLeft } from "@gravity-ui/icons";
import type { SidemenuStructure } from "@/shared/types";

const CurrentSeason = "2026";
const CurrentSeasonTimeSpan = "03.03.2026 - 08.08.2026";

export default function Sidemenu({ structure, linkPrefix }: { structure: SidemenuStructure; linkPrefix: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const _toggleSidemenu = () => setIsOpen(!isOpen);

  const activeView = usePathname().replace(`/${linkPrefix}/`, "");

  return (
    <>
      <header className=" w-[95%] self-center-safe xl:hidden mt-1.5 rounded-xl sticky top-0 mb-1 flex items-center gap-3 px-3 py-2 bg-secondary-light/80 dark:bg-secondary-dark/80 backdrop-blur-md border-y border-tertiary-light dark:border-tertiary-dark shadow-sm">
        <button
          onClick={_toggleSidemenu}
          className="p-2 rounded-lg bg-quaternary-light/50 dark:bg-quaternary-dark/50 hover:opacity-80 transition-opacity"
          aria-label="Toggle Menu">
          <LayoutSideContentLeft className="h-6 w-6 text-text-black dark:text-text-white" />
        </button>

        <Separator
          orientation="vertical"
          className="h-full bg-tertiary-light dark:bg-senary-dark"
        />

        <h2 className="text-fluid-lg font-semibold capitalize tracking-wide truncate">{activeView || "Dashboard"}</h2>
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
        <div className="py-2 px-4">
          <h1 className="h-fit text-lg/6 font-secondary font-bold ">{`Saison ${CurrentSeason}`}</h1>
          <p className="text-fluid-xxs font-secondary pl-[2px]">{CurrentSeasonTimeSpan}</p>
        </div>

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
                      isActive={activeView === sub_option.id}
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
