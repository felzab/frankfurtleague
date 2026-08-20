"use client";

import { useSearchParams } from "next/navigation";

import { Separator } from "@heroui/react";

import { SidemenuNavItem } from "./SidemenuNavItem";

import type { SidemenuStructure } from "@/shared/types/types";

interface SidemenuNavLinksProps<TIcon extends string> {
  structure: SidemenuStructure<TIcon>;
  linkPrefix: string;
  iconDictionary: Record<TIcon, React.ElementType>;
  isDesktopCollapsed: boolean;
  pathname: string;
  onMobileClose: () => void;
}

/**
 * The nav list itself, deliberately hook-free — it is its own Suspense fallback, so `queryString` is passed in rather
 * than read here and this can render during a prerender.
 */
export function SidemenuNavLinks<TIcon extends string>({
  structure,
  linkPrefix,
  iconDictionary,
  isDesktopCollapsed,
  pathname,
  onMobileClose,
  queryString,
}: SidemenuNavLinksProps<TIcon> & { queryString: string }) {
  const checkIsActive = (itemId: string) => {
    const targetPath = `${linkPrefix}/${itemId}`;
    return pathname === targetPath || pathname.startsWith(`${targetPath}/`);
  };

  return (
    <div className="flex flex-col gap-5">
      {structure.map((group) => (
        <div
          // The first item's id, not the category name: a category may deliberately have none, and every
          // id is a route segment and so unique across the structure.
          key={group.sub_options[0]?.id ?? group.category_name}
          className="flex flex-col gap-1">
          {/* An unnamed category renders neither a label nor a rule; the gap between groups still separates it. */}
          {isDesktopCollapsed ? (
            <Separator className="bg-border my-1 w-1/2 self-center" />
          ) : (
            group.category_name !== "" && <span className="muted-hint px-2 pb-1">{group.category_name}</span>
          )}

          {/* `items-center` while collapsed, matching the footer's own container: the two must agree or the rail
              reads as two columns of different widths. */}
          <div className={`flex flex-col gap-[2px] ${isDesktopCollapsed ? "items-center" : ""}`}>
            {group.sub_options.map((sub_option) => {
              const targetPath = `${linkPrefix}/${sub_option.id}`;
              const finalHref = queryString ? `${targetPath}?${queryString}` : targetPath;

              return (
                <SidemenuNavItem
                  key={sub_option.id}
                  href={finalHref}
                  label={sub_option.label}
                  isActive={checkIsActive(sub_option.id)}
                  isDesktopCollapsed={isDesktopCollapsed}
                  icon={iconDictionary[sub_option.iconName]}
                  onMobileNavigate={onMobileClose}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Isolates `useSearchParams()` below a Suspense boundary: it hangs unconditionally in a client prerender, so with
 * no boundary the bailout reaches the route root. `usePathname()` stays in `Sidemenu`, hanging only on a dynamic segment.
 */
export function SidemenuNavLinksWithSaisonQuery<TIcon extends string>(props: SidemenuNavLinksProps<TIcon>) {
  const searchParams = useSearchParams();

  const globalSaisonId = searchParams.get("saison_id");
  const globalQuery = new URLSearchParams();
  if (globalSaisonId) {
    globalQuery.set("saison_id", globalSaisonId);
  }

  return (
    <SidemenuNavLinks
      {...props}
      queryString={globalQuery.toString()}
    />
  );
}
