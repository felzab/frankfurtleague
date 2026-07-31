"use client";

import { useSearchParams } from "next/navigation";

import { Separator } from "@heroui/react";

import SidemenuNavItem from "./SidemenuNavItem";

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
 * This exists only to isolate `useSearchParams()` below a Suspense boundary (ledger NEW-SC10).
 * Verified in `next/dist/server/app-render/dynamic-rendering.js`: `useDynamicSearchParams` hangs
 * **unconditionally** in a `prerender-client` pass, so with no boundary above it the bailout reached
 * the route root and neither dashboard nor admin had a static shell worth the name — 5.4–6.7 KB
 * stubs against 18–44 KB on the public routes.
 *
 * `usePathname()` stays in `Sidemenu`: the same file shows it only hangs when `fallbackRouteParams`
 * is non-empty, i.e. on a dynamic segment that was never prerendered. That is true of the two
 * `[team_id]` routes and nothing else, so it costs those two their shell and no others.
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
