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
 * The nav list itself. **Deliberately hook-free** — it is its own Suspense fallback.
 *
 * `queryString` is passed in rather than read here so that this component can render during a
 * prerender. See `SidemenuNavLinksWithSaisonQuery` for why that matters.
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
          // The first item's id, not the category name: a category may deliberately have no name (see
          // `SidemenuStructureEntry`), and every id is a route segment, so it is unique across the
          // whole structure where an empty name would not be.
          key={group.sub_options[0]?.id ?? group.category_name}
          className="flex flex-col gap-1">
          {/* An unnamed category renders neither a label nor a rule, and the `gap-5` between groups is
              what still separates it. A heading with no text is a 4px box plus a line height of dead
              space, and a rule above the first group would read as a divider from the bar above it. */}
          {isDesktopCollapsed ? (
            <Separator className="bg-border my-1 w-1/2 self-center" />
          ) : (
            group.category_name !== "" && <span className="text-foreground-muted fluid-sm px-2 pb-1 font-medium">{group.category_name}</span>
          )}

          {/* `items-center` while collapsed, so the 36x36 squares sit on the column's centre — the
              footer's own container does exactly this, and the two have to agree or the rail reads as
              two columns of different widths. Expanded, the rows are full width and stretch is right. */}
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
                  onMobileClick={onMobileClose}
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
 * The same list, with `?saison_id=` carried across every nav link.
 *
 * This exists only to isolate `useSearchParams()` below a Suspense boundary.
 * Verified in `next/dist/server/app-render/dynamic-rendering.js`: `useDynamicSearchParams` hangs
 * **unconditionally** in a `prerender-client` pass, so with no boundary above it the bailout reached
 * the route root and neither dashboard nor admin had a static shell worth the name — 5.4–6.7 KB
 * stubs against 18–44 KB on the public routes.
 *
 * `usePathname()` stays in `Sidemenu`: the same file shows it only hangs when `fallbackRouteParams`
 * is non-empty, i.e. on a dynamic segment that was never prerendered. That is true of every dynamic
 * segment under this shell, so those routes lose their shell and the static ones do not.
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
