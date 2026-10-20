"use client";

import { Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import { Separator } from "@heroui/react/separator";

import { skeletonBlock } from "../../ui/skeleton";
import { useLinkPrefix } from "../shell/linkPrefix";
import { SidemenuNavItem } from "./SidemenuNavItem";
import { useSidemenuState } from "./SidemenuState";

import type { SidemenuStructure } from "@/shared/types/types";

interface SidemenuNavLinksProps<TIcon extends string> {
  structure: SidemenuStructure<TIcon>;
  linkPrefix: string;
  iconDictionary: Readonly<Record<TIcon, React.ElementType>>;
  isDesktopCollapsed: boolean;
  /** `null` where the address is not yet read, which marks no entry current. */
  pathname: string | null;
  onMobileClose: () => void;
}

/**
 * The nav list itself, deliberately hook-free — it is its own Suspense fallback, so `queryString` is passed in rather
 * than read here and this can render during a prerender.
 */
function SidemenuNavLinks<TIcon extends string>({
  structure,
  linkPrefix,
  iconDictionary,
  isDesktopCollapsed,
  pathname,
  onMobileClose,
  queryString,
}: SidemenuNavLinksProps<TIcon> & { queryString: string }) {
  // An empty id is the area's own landing, at the prefix itself rather than a trailing slash below it.
  const targetPathOf = (itemId: string) => (itemId === "" ? linkPrefix : `${linkPrefix}/${itemId}`);

  // Every other entry's address sits beneath the landing's, so the landing is active on its own address
  // alone, or it would light beside whichever entry the reader is on.
  const checkIsActive = (itemId: string) => {
    const targetPath = targetPathOf(itemId);
    return pathname === targetPath || (pathname !== null && itemId !== "" && pathname.startsWith(`${targetPath}/`));
  };

  return (
    <div className="flex flex-col gap-4">
      {structure.map((group) => (
        <div
          // The first item's id, not the category name: a category may deliberately have none, and every
          // id is a route segment and so unique across the structure.
          key={group.sub_options[0]?.id ?? group.category_name}
          className="flex flex-col gap-2">
          {/* An unnamed category renders neither a label nor a rule; the gap between groups still separates it. */}
          {isDesktopCollapsed ? (
            // The glyph's own width, `size-4.5` in `SidemenuNavItem`, rather than a fraction: the column this sits in is
            // narrower than the squares below it, so half of it is a rule half a glyph wide.
            <Separator className="w-4.5 self-center bg-border" />
          ) : (
            group.category_name !== "" && <span className="px-2 muted-hint">{group.category_name}</span>
          )}

          {/* `items-center` while collapsed, matching the footer's own container: the two must agree or the rail
              reads as two columns of different widths. */}
          <div className={`flex flex-col gap-0.5 ${isDesktopCollapsed ? "items-center" : ""}`}>
            {group.sub_options.map((sub_option) => {
              const targetPath = targetPathOf(sub_option.id);
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
 * no boundary the bailout reaches the route root.
 */
function SidemenuNavLinksWithSaisonQuery<TIcon extends string>(props: SidemenuNavLinksProps<TIcon>) {
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

/**
 * The rail's entries, built by a layout as plain data where the session says which show. `usePathname()` hangs in a
 * prerender wherever a segment is unknown, so the list waits in a boundary of its own, marking nothing current.
 */
export function SidemenuEntries<TIcon extends string>({
  structure,
  iconDictionary,
}: {
  structure: SidemenuStructure<TIcon>;
  /**
   * A prop typed with the structure, so an entry whose glyph its area lacks fails to compile. Each area's client
   * wrapper binds it, as a server layout can hand no component to the client.
   */
  iconDictionary: Readonly<Record<TIcon, React.ElementType>>;
}) {
  const { linkPrefix, isDesktopCollapsed, onMobileClose } = useSidemenuState();

  return (
    <Suspense
      fallback={
        // A prefix off the address is no more known than the address, so that list waits whole.
        typeof linkPrefix === "string" ? (
          <SidemenuNavLinks
            structure={structure}
            linkPrefix={linkPrefix}
            iconDictionary={iconDictionary}
            isDesktopCollapsed={isDesktopCollapsed}
            pathname={null}
            onMobileClose={onMobileClose}
            queryString=""
          />
        ) : null
      }>
      <SidemenuEntriesAtAddress
        structure={structure}
        iconDictionary={iconDictionary}
      />
    </Suspense>
  );
}

/**
 * Stands in for entries the session decides, in `SidemenuNavItem`'s row box, so nothing below moves when they
 * arrive; no link, since where they lead is what the read decides.
 */
export function SidemenuEntriesSkeleton({ rows }: { rows: number }) {
  const { isDesktopCollapsed } = useSidemenuState();

  return (
    <div
      role="status"
      className={`flex flex-col gap-0.5 ${isDesktopCollapsed ? "items-center" : ""}`}>
      {/* In the subtree rather than in `aria-label`, for `SaisonSlotSkeleton`'s reason. */}
      <span className="sr-only">Menü wird geladen</span>
      {Array.from({ length: rows }, (_, row) => (
        <div
          key={row}
          className={`flex h-9 items-center rounded-md ${isDesktopCollapsed ? "w-9 justify-center" : "w-full gap-2 px-3"}`}>
          <span className={`${skeletonBlock()} size-4.5 shrink-0 rounded`} />
          {!isDesktopCollapsed && <span className={`${skeletonBlock()} block w-24 rounded fluid-sm`}>&nbsp;</span>}
        </div>
      ))}
    </div>
  );
}

function SidemenuEntriesAtAddress<TIcon extends string>({
  structure,
  iconDictionary,
}: {
  structure: SidemenuStructure<TIcon>;
  iconDictionary: Readonly<Record<TIcon, React.ElementType>>;
}) {
  const state = useSidemenuState();
  const props = {
    structure: structure,
    linkPrefix: useLinkPrefix(state.linkPrefix),
    iconDictionary: iconDictionary,
    isDesktopCollapsed: state.isDesktopCollapsed,
    pathname: usePathname(),
    onMobileClose: state.onMobileClose,
  };

  // Only a shell keeping its season in the query reads one, in a boundary of its own: the address's path is
  // known to the build wherever no segment is a parameter, its query never.
  return state.keepsSaisonQuery ? (
    <Suspense
      fallback={
        <SidemenuNavLinks
          {...props}
          queryString=""
        />
      }>
      <SidemenuNavLinksWithSaisonQuery {...props} />
    </Suspense>
  ) : (
    <SidemenuNavLinks
      {...props}
      queryString=""
    />
  );
}
