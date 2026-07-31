"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Whether a CSS media query currently matches. `false` on the server and until the first client
 * snapshot, so the caller must pick a query whose `false` branch is the safe one — for the sidemenu
 * that is "not inert", i.e. never wrongly inert.
 *
 * `useSyncExternalStore`, not `useState` + `useEffect`: the effect form has to call `setState` in
 * the effect body to catch a query that already matched at mount (`change` only fires on a
 * transition), which `react-hooks/set-state-in-effect` rejects as a cascading render. A media query
 * is an external store, so this is the shape the rule is pointing at.
 *
 * Both callbacks are memoised on `query`. An inline `subscribe` would be a new function identity
 * every render, and React tears down and re-subscribes whenever it changes.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onStoreChange);
      return () => list.removeEventListener("change", onStoreChange);
    },
    [query],
  );

  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query]);

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/**
 * Below Tailwind's `lg` breakpoint (64rem), where the sidemenu is an overlay drawer rather than the
 * always-visible desktop rail. Written as a query because `inert` is a DOM property and cannot be
 * expressed as a variant.
 */
export const BELOW_LG_QUERY = "(max-width: 1023.98px)";
