"use client";

import { createContext, useCallback, useContext } from "react";

import { useSaisonId } from "@/shared/hooks/useSaisonHref";
import { withSaisonId } from "@/shared/utils/saisonHref";

import type { ReactNode } from "react";

/**
 * **A context rather than a prop**: an area's `not-found.tsx` renders `ShellNotFound` below the shell
 * with no props from it, and a second declaration there could disagree with the shell's own.
 */
const ShellSaisonQueryContext = createContext<boolean | undefined>(undefined);

export function ShellSaisonQueryProvider({ keepsSaisonQuery, children }: { keepsSaisonQuery: boolean; children: ReactNode }) {
  return <ShellSaisonQueryContext.Provider value={keepsSaisonQuery}>{children}</ShellSaisonQueryContext.Provider>;
}

/**
 * A path as the shell around it links: carrying the live url's `saison_id` where that shell keeps
 * the season in the query, and untouched where the season is in the path or nowhere.
 */
export function useShellSaisonHref(): (path: string) => string {
  const keepsSaisonQuery = useContext(ShellSaisonQueryContext);
  if (keepsSaisonQuery === undefined) {
    throw new Error("useShellSaisonHref must be used within an AppShell");
  }
  // Read whatever the shell declares, as a hook may not be called conditionally; a shell keeping no
  // query ignores it.
  const saisonId = useSaisonId();

  return useCallback((path: string) => (keepsSaisonQuery ? withSaisonId(path, saisonId) : path), [keepsSaisonQuery, saisonId]);
}
